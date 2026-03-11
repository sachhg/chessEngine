import json
import math
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path

import chess

from archetypes import Archetype
from engine import AdaptiveEngine


RESULTS_DIR = Path(__file__).parent / "data" / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class GameRecord:
    game_num: int
    result: str  # "1-0", "0-1", "1/2-1/2"
    num_moves: int
    white_was_adaptive: bool
    moves: list = field(default_factory=list)
    adaptive_won: bool = False
    adaptive_drew: bool = False


@dataclass
class MatchupStats:
    wins: int = 0
    draws: int = 0
    losses: int = 0
    total_moves: int = 0
    game_count: int = 0

    @property
    def win_rate(self) -> float:
        return self.wins / self.game_count if self.game_count else 0.0

    @property
    def score(self) -> float:
        """(wins + 0.5*draws) / total"""
        return (self.wins + 0.5 * self.draws) / self.game_count if self.game_count else 0.5

    @property
    def avg_game_length(self) -> float:
        return self.total_moves / self.game_count if self.game_count else 0.0

    @property
    def elo_diff(self) -> float:
        """Estimate Elo difference from score."""
        s = self.score
        if s <= 0.0:
            return -400.0
        if s >= 1.0:
            return 400.0
        return -400.0 * math.log10(1.0 / s - 1.0)

    def to_dict(self) -> dict:
        return {
            "wins": self.wins,
            "draws": self.draws,
            "losses": self.losses,
            "win_rate": round(self.win_rate, 4),
            "score": round(self.score, 4),
            "avg_game_length": round(self.avg_game_length, 1),
            "elo_diff": round(self.elo_diff, 1),
            "game_count": self.game_count,
        }


def play_single_game(
    archetype: Archetype,
    adaptive_is_white: bool,
    adaptive_enabled: bool = True,
    time_per_move: float = 0.3,
    move_callback=None,
    game_num: int = 0,
) -> GameRecord:
    """
    Play one game between the adaptive engine and a proxy opponent.
    move_callback is called with (game_num, move_data) after each move for live streaming.
    """
    if adaptive_enabled:
        adaptive = AdaptiveEngine(archetype=archetype, proxy_mode=False)
    else:
        # Baseline: no archetype awareness, just default Stockfish
        adaptive = AdaptiveEngine(archetype=None, proxy_mode=False)

    proxy = AdaptiveEngine(archetype=archetype, proxy_mode=True)

    board = chess.Board()
    moves = []
    move_num = 0

    try:
        while not board.is_game_over() and board.fullmove_number < 150:
            is_white_turn = (board.turn == chess.WHITE)
            is_adaptive_turn = (is_white_turn == adaptive_is_white)

            if is_adaptive_turn:
                data = adaptive.pick_move(board, time_limit=time_per_move)
            else:
                data = proxy.pick_move(board, time_limit=time_per_move)

            move = data["move"]
            entry = {
                "move_num": move_num,
                "uci": data["uci"],
                "san": data["san"],
                "fen": board.fen(),
                "eval": data.get("eval", 0),
                "phase": data.get("phase", ""),
                "side": "adaptive" if is_adaptive_turn else "proxy",
            }
            moves.append(entry)

            if move_callback:
                move_callback(game_num, entry)

            board.push(move)
            move_num += 1

    finally:
        adaptive.close()
        proxy.close()

    result_str = board.result()
    adaptive_won = (
        (result_str == "1-0" and adaptive_is_white) or
        (result_str == "0-1" and not adaptive_is_white)
    )
    adaptive_drew = result_str == "1/2-1/2"

    return GameRecord(
        game_num=game_num,
        result=result_str,
        num_moves=move_num,
        white_was_adaptive=adaptive_is_white,
        moves=moves,
        adaptive_won=adaptive_won,
        adaptive_drew=adaptive_drew,
    )


def run_matchup(
    archetype: Archetype,
    num_games: int = 20,
    adaptive_enabled: bool = True,
    time_per_move: float = 0.3,
    move_callback=None,
    progress_callback=None,
) -> tuple[list[GameRecord], MatchupStats]:
    """Run a full set of games for one archetype."""
    records = []
    stats = MatchupStats()

    for i in range(num_games):
        white_is_adaptive = (i % 2 == 0)
        rec = play_single_game(
            archetype=archetype,
            adaptive_is_white=white_is_adaptive,
            adaptive_enabled=adaptive_enabled,
            time_per_move=time_per_move,
            move_callback=move_callback,
            game_num=i,
        )
        records.append(rec)

        if rec.adaptive_won:
            stats.wins += 1
        elif rec.adaptive_drew:
            stats.draws += 1
        else:
            stats.losses += 1
        stats.total_moves += rec.num_moves
        stats.game_count += 1

        if progress_callback:
            progress_callback(archetype, i + 1, num_games, stats)

    return records, stats


def run_full_simulation(
    archetypes: list[Archetype] = None,
    games_per_matchup: int = 20,
    time_per_move: float = 0.3,
    move_callback=None,
    progress_callback=None,
) -> dict:
    """
    Run adaptive vs baseline for each archetype.
    Returns a results dict ready for JSON serialization.
    """
    if archetypes is None:
        archetypes = list(Archetype)

    sim_id = str(uuid.uuid4())[:8]
    results = {
        "sim_id": sim_id,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "config": {
            "games_per_matchup": games_per_matchup,
            "time_per_move": time_per_move,
            "archetypes": [a.value for a in archetypes],
        },
        "matchups": {},
    }

    for arch in archetypes:
        # Adaptive run
        adaptive_records, adaptive_stats = run_matchup(
            archetype=arch,
            num_games=games_per_matchup,
            adaptive_enabled=True,
            time_per_move=time_per_move,
            move_callback=move_callback,
            progress_callback=progress_callback,
        )

        # Baseline run
        baseline_records, baseline_stats = run_matchup(
            archetype=arch,
            num_games=games_per_matchup,
            adaptive_enabled=False,
            time_per_move=time_per_move,
            move_callback=move_callback,
            progress_callback=progress_callback,
        )

        improvement = {
            "win_rate_delta": round(adaptive_stats.win_rate - baseline_stats.win_rate, 4),
            "score_delta": round(adaptive_stats.score - baseline_stats.score, 4),
            "elo_diff_estimate": round(adaptive_stats.elo_diff - baseline_stats.elo_diff, 1),
        }

        results["matchups"][arch.value] = {
            "adaptive": adaptive_stats.to_dict(),
            "baseline": baseline_stats.to_dict(),
            "improvement": improvement,
            "adaptive_games": [
                {"game_num": r.game_num, "result": r.result, "num_moves": r.num_moves,
                 "adaptive_won": r.adaptive_won, "moves": r.moves}
                for r in adaptive_records
            ],
            "baseline_games": [
                {"game_num": r.game_num, "result": r.result, "num_moves": r.num_moves,
                 "adaptive_won": r.adaptive_won, "moves": r.moves}
                for r in baseline_records
            ],
        }

    return results


def save_results(results: dict) -> Path:
    """Save simulation results to JSON file."""
    fname = f"sim_{results['sim_id']}.json"
    path = RESULTS_DIR / fname
    with open(path, "w") as f:
        json.dump(results, f, indent=2)
    return path


def load_results(sim_id: str) -> dict:
    """Load results by simulation ID."""
    path = RESULTS_DIR / f"sim_{sim_id}.json"
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def list_results() -> list[dict]:
    """List all saved simulation results (metadata only)."""
    summaries = []
    for p in sorted(RESULTS_DIR.glob("sim_*.json"), reverse=True):
        try:
            with open(p) as f:
                data = json.load(f)
            summaries.append({
                "sim_id": data["sim_id"],
                "timestamp": data["timestamp"],
                "config": data["config"],
                "matchups_summary": {
                    arch: {
                        "adaptive_score": m["adaptive"]["score"],
                        "baseline_score": m["baseline"]["score"],
                        "improvement": m["improvement"]["score_delta"],
                    }
                    for arch, m in data.get("matchups", {}).items()
                },
            })
        except (json.JSONDecodeError, KeyError):
            continue
    return summaries
