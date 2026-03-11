import asyncio
import json
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from archetypes import Archetype
from profiler import extract_features
from simulator import (
    run_matchup, play_single_game, save_results,
    load_results, list_results, RESULTS_DIR,
)

app = FastAPI(title="PDSO Chess Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory state
_simulations = {}  # sim_id -> {"status": ..., "results": ..., "task": ...}
_ws_clients = {}   # sim_id -> set of WebSocket connections

STATIC_DIR = Path(__file__).parent / "static"
DATA_DIR = Path(__file__).parent / "data"


# --- REST endpoints ---

@app.post("/api/profile")
async def profile_opponent(file: UploadFile = File(...), player_name: str = "", quick: bool = True):
    content = await file.read()
    pgn_text = content.decode("utf-8", errors="ignore")

    if not player_name:
        return JSONResponse({"error": "player_name query parameter required"}, status_code=400)

    # Run in thread pool to avoid blocking
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, extract_features, pgn_text, player_name, quick
    )

    if result is None:
        return JSONResponse(
            {"error": f"No games found for player '{player_name}'"},
            status_code=404,
        )

    return result


@app.post("/api/simulate")
async def start_simulation(
    archetype: str = None,
    num_games: int = 5,
    time_per_move: float = 0.3,
):
    """Start a simulation as a background task. Returns sim_id to track progress."""
    sim_id = str(uuid.uuid4())[:8]

    if archetype:
        try:
            archetypes = [Archetype(archetype)]
        except ValueError:
            return JSONResponse({"error": f"Unknown archetype: {archetype}"}, status_code=400)
    else:
        archetypes = list(Archetype)

    _simulations[sim_id] = {
        "status": "running",
        "results": None,
        "archetypes": [a.value for a in archetypes],
        "num_games": num_games,
        "progress": {},
    }

    task = asyncio.create_task(
        _run_simulation_task(sim_id, archetypes, num_games, time_per_move)
    )
    _simulations[sim_id]["task"] = task

    return {"sim_id": sim_id, "status": "running"}


@app.get("/api/simulate/{sim_id}")
async def get_simulation(sim_id: str):
    if sim_id not in _simulations:
        saved = load_results(sim_id)
        if saved:
            return {"status": "completed", "results": saved}
        return JSONResponse({"error": "Simulation not found"}, status_code=404)

    sim = _simulations[sim_id]
    return {
        "status": sim["status"],
        "progress": sim.get("progress", {}),
        "results": sim.get("results"),
    }


@app.get("/api/results")
async def get_all_results():
    return list_results()


@app.get("/api/results/{sim_id}")
async def get_result(sim_id: str):
    data = load_results(sim_id)
    if data is None:
        return JSONResponse({"error": "Results not found"}, status_code=404)
    return data


@app.get("/api/demo-results")
async def get_demo_results():
    """Return the most recent cached simulation result for demo mode."""
    results = list_results()
    if not results:
        return JSONResponse({"error": "No cached results. Run a simulation first."}, status_code=404)
    # Return the full data for the most recent result
    return load_results(results[0]["sim_id"])


# --- WebSocket for live game streaming ---

@app.websocket("/ws/game/{sim_id}")
async def game_ws(websocket: WebSocket, sim_id: str):
    await websocket.accept()

    if sim_id not in _ws_clients:
        _ws_clients[sim_id] = set()
    _ws_clients[sim_id].add(websocket)

    try:
        while True:
            # Keep connection alive; client doesn't need to send anything
            await websocket.receive_text()
    except WebSocketDisconnect:
        _ws_clients[sim_id].discard(websocket)


async def _broadcast(sim_id: str, data: dict):
    clients = _ws_clients.get(sim_id, set())
    dead = set()
    for ws in clients:
        try:
            await ws.send_json(data)
        except Exception:
            dead.add(ws)
    clients -= dead


async def _run_simulation_task(
    sim_id: str,
    archetypes: list[Archetype],
    num_games: int,
    time_per_move: float,
):
    """Background task that runs the simulation and streams progress."""
    loop = asyncio.get_event_loop()
    all_results = {
        "sim_id": sim_id,
        "timestamp": __import__("time").strftime("%Y-%m-%d %H:%M:%S"),
        "config": {
            "games_per_matchup": num_games,
            "time_per_move": time_per_move,
            "archetypes": [a.value for a in archetypes],
        },
        "matchups": {},
    }

    await _broadcast(sim_id, {"type": "sim_start", "sim_id": sim_id})

    for arch in archetypes:
        for condition in ["adaptive", "baseline"]:
            adaptive_enabled = (condition == "adaptive")
            label = f"{arch.value}_{condition}"

            await _broadcast(sim_id, {
                "type": "matchup_start",
                "archetype": arch.value,
                "condition": condition,
            })

            records = []
            stats_dict = {"wins": 0, "draws": 0, "losses": 0, "total_moves": 0}

            for i in range(num_games):
                white_is_adaptive = (i % 2 == 0)

                await _broadcast(sim_id, {
                    "type": "game_start",
                    "game_num": i,
                    "archetype": arch.value,
                    "condition": condition,
                    "white": "adaptive" if white_is_adaptive else f"proxy_{arch.value}",
                    "black": f"proxy_{arch.value}" if white_is_adaptive else "adaptive",
                })

                # Run game in thread pool
                move_buffer = []

                def on_move(game_num, move_data):
                    move_buffer.append(move_data)

                rec = await loop.run_in_executor(
                    None,
                    lambda: play_single_game(
                        archetype=arch,
                        adaptive_is_white=white_is_adaptive,
                        adaptive_enabled=adaptive_enabled,
                        time_per_move=time_per_move,
                        move_callback=on_move,
                        game_num=i,
                    ),
                )

                # Stream the moves (batch for speed, send last few for live feel)
                if move_buffer:
                    for mv in move_buffer[-6:]:
                        await _broadcast(sim_id, {"type": "move", "game_num": i, **mv})
                        await asyncio.sleep(0.05)

                records.append(rec)
                if rec.adaptive_won:
                    stats_dict["wins"] += 1
                elif rec.adaptive_drew:
                    stats_dict["draws"] += 1
                else:
                    stats_dict["losses"] += 1
                stats_dict["total_moves"] += rec.num_moves

                await _broadcast(sim_id, {
                    "type": "game_end",
                    "game_num": i,
                    "result": rec.result,
                    "adaptive_won": rec.adaptive_won,
                    "num_moves": rec.num_moves,
                })

                _simulations[sim_id]["progress"][label] = {
                    "completed": i + 1,
                    "total": num_games,
                    **stats_dict,
                }

            # Compute stats for this condition
            gc = len(records)
            w, d, l = stats_dict["wins"], stats_dict["draws"], stats_dict["losses"]
            score = (w + 0.5 * d) / gc if gc else 0.5
            wr = w / gc if gc else 0.0

            import math
            if 0 < score < 1:
                elo = -400.0 * math.log10(1.0 / score - 1.0)
            elif score >= 1:
                elo = 400.0
            else:
                elo = -400.0

            cond_stats = {
                "wins": w, "draws": d, "losses": l,
                "win_rate": round(wr, 4),
                "score": round(score, 4),
                "avg_game_length": round(stats_dict["total_moves"] / gc, 1) if gc else 0,
                "elo_diff": round(elo, 1),
                "game_count": gc,
            }

            if arch.value not in all_results["matchups"]:
                all_results["matchups"][arch.value] = {}
            all_results["matchups"][arch.value][condition] = cond_stats
            all_results["matchups"][arch.value][f"{condition}_games"] = [
                {"game_num": r.game_num, "result": r.result, "num_moves": r.num_moves,
                 "adaptive_won": r.adaptive_won, "moves": r.moves}
                for r in records
            ]

    # Compute improvement for each matchup
    for arch_name, matchup in all_results["matchups"].items():
        a = matchup.get("adaptive", {})
        b = matchup.get("baseline", {})
        matchup["improvement"] = {
            "win_rate_delta": round(a.get("win_rate", 0) - b.get("win_rate", 0), 4),
            "score_delta": round(a.get("score", 0) - b.get("score", 0), 4),
            "elo_diff_estimate": round(a.get("elo_diff", 0) - b.get("elo_diff", 0), 1),
        }

    # Save and finalize
    save_results(all_results)
    _simulations[sim_id]["status"] = "completed"
    _simulations[sim_id]["results"] = all_results

    await _broadcast(sim_id, {"type": "sim_end", "sim_id": sim_id, "results": all_results})


@app.get("/dashboard")
async def dashboard_page():
    return FileResponse(str(STATIC_DIR / "dashboard.html"))


# Mount static files last so API routes take priority
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
