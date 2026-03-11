import math
from io import StringIO

import chess
import chess.pgn
import chess.engine

from archetypes import (
    Archetype, CENTROIDS, COUNTER_PARAMS, PIECE_VALUES, FEATURE_LABELS,
)
from engine import find_stockfish


def _material_for_color(board: chess.Board, color: bool) -> int:
    total = 0
    for sq in chess.SQUARES:
        pc = board.piece_at(sq)
        if pc and pc.color == color and pc.piece_type != chess.KING:
            total += PIECE_VALUES[pc.piece_type]
    return total


def _total_material(board: chess.Board) -> int:
    return _material_for_color(board, chess.WHITE) + _material_for_color(board, chess.BLACK)


def _piece_advancement(board: chess.Board, color: bool) -> float:
    """Average rank of non-pawn, non-king pieces for a color. Higher = more advanced."""
    ranks = []
    for sq in chess.SQUARES:
        pc = board.piece_at(sq)
        if pc and pc.color == color and pc.piece_type not in (chess.PAWN, chess.KING):
            r = chess.square_rank(sq)
            if color == chess.BLACK:
                r = 7 - r
            ranks.append(r)
    return sum(ranks) / len(ranks) if ranks else 3.5


def _squares_near_king(board: chess.Board, color: bool, radius: int = 2) -> set:
    king_sq = board.king(color)
    if king_sq is None:
        return set()
    result = set()
    kr, kf = chess.square_rank(king_sq), chess.square_file(king_sq)
    for r in range(max(0, kr - radius), min(8, kr + radius + 1)):
        for f in range(max(0, kf - radius), min(8, kf + radius + 1)):
            result.add(chess.square(f, r))
    return result


def _is_kingside_pawn_advance(move: chess.Move, color: bool, board: chess.Board) -> bool:
    pc = board.piece_at(move.from_square)
    if pc is None or pc.piece_type != chess.PAWN:
        return False
    file = chess.square_file(move.to_square)
    if file < 5:
        return False
    from_rank = chess.square_rank(move.from_square)
    to_rank = chess.square_rank(move.to_square)
    if color == chess.WHITE:
        return to_rank > from_rank
    return to_rank < from_rank


CENTER_SQUARES = {chess.D4, chess.D5, chess.E4, chess.E5,
                  chess.C3, chess.C4, chess.C5, chess.C6,
                  chess.F3, chess.F4, chess.F5, chess.F6}


def extract_features(pgn_text: str, player_name: str, quick: bool = False) -> dict:
    """
    Parse PGN and compute behavioral features for a specific player.
    quick=True skips engine analysis and uses heuristic estimates instead.
    """
    games = _parse_games(pgn_text, player_name)
    if not games:
        return None

    total_moves = 0
    total_captures = 0
    advancement_sum = 0.0
    king_pressure_moves = 0
    center_moves = 0
    pawn_storm_moves = 0
    game_lengths = []

    # Quick-mode heuristics
    material_dropped_moves = 0     # moves where we lost material (possible sac)
    material_recovered = 0          # of those, how many had eval recovery later
    captures_while_ahead = 0        # captures when we had more material
    total_captures_in_game = 0
    checks_given = 0
    quiet_moves = 0
    retreat_moves = 0

    # Engine-based accumulators
    total_sacrifices = 0
    trades_when_ahead_engine = 0
    captures_when_ahead_engine = 0
    complexity_sum = 0.0
    complexity_count = 0

    sf = None
    if not quick:
        sf = chess.engine.SimpleEngine.popen_uci(find_stockfish())

    try:
        for game, player_color in games:
            board = game.board()
            move_num = 0
            prev_our_mat = _material_for_color(chess.Board(), player_color)

            for node in game.mainline():
                move = node.move
                if move not in board.legal_moves:
                    break

                is_our_move = (board.turn == player_color)

                if is_our_move:
                    total_moves += 1

                    # Material greed
                    if board.is_capture(move):
                        total_captures += 1

                    # Piece advancement
                    adv = _piece_advancement(board, player_color)
                    advancement_sum += adv

                    # King pressure
                    opp_king_zone = _squares_near_king(board, not player_color)
                    if move.to_square in opp_king_zone:
                        king_pressure_moves += 1

                    # Center control
                    if move.to_square in CENTER_SQUARES:
                        center_moves += 1

                    # Pawn storms
                    if _is_kingside_pawn_advance(move, player_color, board):
                        pawn_storm_moves += 1

                    # Check if move gives check
                    sim = board.copy()
                    sim.push(move)
                    if sim.is_check():
                        checks_given += 1

                    # Quiet vs aggressive move detection
                    pc = board.piece_at(move.from_square)
                    if pc:
                        from_rank = chess.square_rank(move.from_square)
                        to_rank = chess.square_rank(move.to_square)
                        if player_color == chess.WHITE:
                            moved_back = to_rank < from_rank
                        else:
                            moved_back = to_rank > from_rank
                        if moved_back and pc.piece_type not in (chess.PAWN, chess.KING):
                            retreat_moves += 1
                        if not board.is_capture(move) and not sim.is_check():
                            quiet_moves += 1

                    # Quick-mode sacrifice heuristic: check if we lose material on this move
                    our_mat_before = _material_for_color(board, player_color)
                    sim2 = board.copy()
                    sim2.push(move)
                    our_mat_after = _material_for_color(sim2, player_color)
                    if our_mat_before - our_mat_after > 100:
                        material_dropped_moves += 1

                    # Quick-mode trade-when-ahead: capture when we have more material
                    if board.is_capture(move):
                        total_captures_in_game += 1
                        their_mat = _material_for_color(board, not player_color)
                        if our_mat_before > their_mat + 150:
                            captures_while_ahead += 1

                    # Engine-based features
                    if sf:
                        if board.is_capture(move):
                            info = sf.analyse(board, chess.engine.Limit(depth=8))
                            cp = info["score"].pov(player_color).score(mate_score=10000)
                            if cp > 150:
                                captures_when_ahead_engine += 1
                                trades_when_ahead_engine += 1
                            else:
                                captures_when_ahead_engine += 1

                        # Sacrifice detection
                        if our_mat_before - our_mat_after > 100:
                            info_after = sf.analyse(sim2, chess.engine.Limit(depth=8))
                            eval_after = info_after["score"].pov(player_color).score(mate_score=10000)
                            if eval_after > -100:
                                total_sacrifices += 1

                        # Complexity preference (sampled)
                        if move_num % 5 == 0:
                            info = sf.analyse(board, chess.engine.Limit(depth=8), multipv=4)
                            if len(info) >= 2:
                                scores = [e["score"].pov(board.turn).score(mate_score=10000) for e in info]
                                spread = abs(scores[0] - scores[-1])
                                complexity_sum += 1.0 - min(spread / 300.0, 1.0)
                                complexity_count += 1

                board.push(move)
                move_num += 1

            game_lengths.append(move_num)
    finally:
        if sf:
            sf.quit()

    if total_moves == 0:
        return None

    # Compute features
    if quick:
        sacrifice_rate = material_dropped_moves / total_moves
        trade_when_ahead = (captures_while_ahead / total_captures_in_game
                           if total_captures_in_game > 3 else 0.5)
        # Heuristic complexity: ratio of checks and captures (sharp play = high complexity pref)
        aggression_ratio = (checks_given + total_captures) / total_moves
        quietness_ratio = quiet_moves / total_moves
        complexity_pref = min(aggression_ratio * 1.5, 1.0)
    else:
        sacrifice_rate = total_sacrifices / total_moves
        trade_when_ahead = (trades_when_ahead_engine / max(captures_when_ahead_engine, 1)
                           if captures_when_ahead_engine > 0 else 0.5)
        complexity_pref = (complexity_sum / complexity_count
                          if complexity_count > 0 else 0.5)

    raw = {
        "material_greed": total_captures / total_moves,
        "sacrifice_rate": sacrifice_rate,
        "avg_piece_advancement": advancement_sum / total_moves / 7.0,
        "king_pressure_index": king_pressure_moves / total_moves,
        "center_control": center_moves / total_moves,
        "pawn_storm_frequency": pawn_storm_moves / total_moves,
        "trade_when_ahead": trade_when_ahead,
        "complexity_preference": complexity_pref,
    }

    return {
        "player_name": player_name,
        "games_analyzed": len(games),
        "avg_game_length": sum(game_lengths) / len(game_lengths),
        "raw_features": raw,
        **classify(raw),
    }


def classify(features: dict) -> dict:
    """Classify feature vector into nearest archetype by Euclidean distance."""
    distances = {}
    for arch, centroid in CENTROIDS.items():
        dist_sq = 0.0
        for feat, val in centroid.items():
            player_val = features.get(feat, 0.5)
            dist_sq += (player_val - val) ** 2
        distances[arch] = round(math.sqrt(dist_sq), 4)

    best = min(distances, key=distances.get)

    max_dist = max(distances.values())
    similarities = {}
    for arch, d in distances.items():
        similarities[arch.value] = round(1.0 - (d / max_dist) if max_dist > 0 else 0.5, 4)

    return {
        "primary_archetype": best.value,
        "archetype_distances": {a.value: d for a, d in distances.items()},
        "archetype_similarities": similarities,
        "recommended_counter": {k: v for k, v in COUNTER_PARAMS[best].items()},
    }


def _parse_games(pgn_text: str, player_name: str) -> list:
    """Return list of (game, player_color) tuples for all games the player participated in."""
    games = []
    pgn_io = StringIO(pgn_text)

    while True:
        game = chess.pgn.read_game(pgn_io)
        if game is None:
            break

        white = game.headers.get("White", "")
        black = game.headers.get("Black", "")

        name_lower = player_name.lower()
        if name_lower in white.lower():
            games.append((game, chess.WHITE))
        elif name_lower in black.lower():
            games.append((game, chess.BLACK))

    return games
