"""
Enrich presets.json with running per-move feature values for White and Black.
Each move gains 'white_features' and 'black_features' dicts with the 8 behavioral features.
"""

import json
import chess
from pathlib import Path

PIECE_VALUES = {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
                chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}

CENTER_SQUARES = {chess.D4, chess.D5, chess.E4, chess.E5,
                  chess.C3, chess.C4, chess.C5, chess.C6,
                  chess.F3, chess.F4, chess.F5, chess.F6}

KINGSIDE_FILES = {4, 5, 6, 7}  # e, f, g, h file indices


def material_count(board, color):
    total = 0
    for sq in chess.SQUARES:
        pc = board.piece_at(sq)
        if pc and pc.color == color:
            total += PIECE_VALUES[pc.piece_type]
    return total


def avg_piece_advancement(board, color):
    """Average rank advancement of pieces (excluding pawns and king)."""
    ranks = []
    for sq in chess.SQUARES:
        pc = board.piece_at(sq)
        if pc and pc.color == color and pc.piece_type not in (chess.PAWN, chess.KING):
            rank = chess.square_rank(sq)
            # Normalize: white advances up (rank/7), black advances down ((7-rank)/7)
            adv = rank / 7.0 if color == chess.WHITE else (7 - rank) / 7.0
            ranks.append(adv)
    return sum(ranks) / len(ranks) if ranks else 0.2


def squares_near_king(board, king_color):
    """Return set of squares within Chebyshev distance 2 of king."""
    king_sq = board.king(king_color)
    if king_sq is None:
        return set()
    kr, kf = chess.square_rank(king_sq), chess.square_file(king_sq)
    result = set()
    for r in range(max(0, kr - 2), min(8, kr + 3)):
        for f in range(max(0, kf - 2), min(8, kf + 3)):
            result.add(chess.square(f, r))
    return result


def enrich_game(game):
    """Add white_features and black_features to each move in the game."""
    board = chess.Board()

    # Running counters per side
    stats = {
        chess.WHITE: {
            "moves": 0, "captures": 0, "sacrifices": 0,
            "center_moves": 0, "king_pressure_moves": 0,
            "pawn_storm_moves": 0, "captures_when_ahead": 0,
            "total_captures_possible": 0, "checks": 0,
        },
        chess.BLACK: {
            "moves": 0, "captures": 0, "sacrifices": 0,
            "center_moves": 0, "king_pressure_moves": 0,
            "pawn_storm_moves": 0, "captures_when_ahead": 0,
            "total_captures_possible": 0, "checks": 0,
        },
    }

    for i, move_data in enumerate(game["moves"]):
        san = move_data["san"]
        fen_before = board.fen()

        # Determine which side is moving
        side = board.turn  # WHITE or BLACK
        enemy = not side
        s = stats[side]

        # Parse the move
        try:
            move = board.parse_san(san)
        except (ValueError, chess.InvalidMoveError):
            # Fallback: try UCI
            try:
                move = chess.Move.from_uci(move_data["uci"])
            except (ValueError, chess.InvalidMoveError):
                # Can't parse, skip enrichment for this move
                move_data["white_features"] = _compute_features(stats[chess.WHITE], board, chess.WHITE)
                move_data["black_features"] = _compute_features(stats[chess.BLACK], board, chess.BLACK)
                continue

        s["moves"] += 1

        # Is it a capture?
        is_capture = board.is_capture(move)
        if is_capture:
            s["captures"] += 1

            # Sacrifice detection: did we lose material on this capture?
            my_piece = board.piece_at(move.from_square)
            captured = board.piece_at(move.to_square)
            if my_piece and captured:
                my_val = PIECE_VALUES.get(my_piece.piece_type, 0)
                cap_val = PIECE_VALUES.get(captured.piece_type, 0)
                if my_val > cap_val + 50:  # Lost material (with margin)
                    s["sacrifices"] += 1

            # Trade when ahead
            my_material = material_count(board, side)
            enemy_material = material_count(board, enemy)
            if my_material > enemy_material:
                s["captures_when_ahead"] += 1
            s["total_captures_possible"] += 1

        # Center control
        if move.to_square in CENTER_SQUARES:
            s["center_moves"] += 1

        # King pressure (targeting squares near enemy king)
        near_king = squares_near_king(board, enemy)
        if move.to_square in near_king:
            s["king_pressure_moves"] += 1

        # Pawn storm (kingside pawn advance)
        piece = board.piece_at(move.from_square)
        if piece and piece.piece_type == chess.PAWN:
            file = chess.square_file(move.to_square)
            from_rank = chess.square_rank(move.from_square)
            to_rank = chess.square_rank(move.to_square)
            is_advance = (to_rank > from_rank) if side == chess.WHITE else (to_rank < from_rank)
            if file in KINGSIDE_FILES and is_advance:
                s["pawn_storm_moves"] += 1

        # Check detection
        board.push(move)
        if board.is_check():
            s["checks"] += 1
        else:
            pass  # board already pushed

        # Compute running features for both sides
        move_data["white_features"] = _compute_features(stats[chess.WHITE], board, chess.WHITE)
        move_data["black_features"] = _compute_features(stats[chess.BLACK], board, chess.BLACK)

    return game


def _compute_features(s, board, color):
    """Compute the 8 features from running stats."""
    total = max(s["moves"], 1)

    greed = s["captures"] / total
    sacrifice = s["sacrifices"] / total
    advancement = avg_piece_advancement(board, color)
    king_press = s["king_pressure_moves"] / total
    center = s["center_moves"] / total
    pawn_storm = s["pawn_storm_moves"] / total
    trade_ahead = (s["captures_when_ahead"] / max(s["total_captures_possible"], 1)
                   if s["total_captures_possible"] > 0 else 0.0)
    complexity = (s["checks"] + s["captures"]) / total

    return {
        "material_greed": round(greed, 4),
        "sacrifice_rate": round(sacrifice, 4),
        "avg_piece_advancement": round(advancement, 4),
        "king_pressure_index": round(king_press, 4),
        "center_control": round(center, 4),
        "pawn_storm_frequency": round(pawn_storm, 4),
        "trade_when_ahead": round(trade_ahead, 4),
        "complexity_preference": round(complexity, 4),
    }


def main():
    presets_path = Path(__file__).parent / "static" / "presets.json"
    with open(presets_path) as f:
        presets = json.load(f)

    for i, game in enumerate(presets):
        print(f"Enriching game {i+1}/{len(presets)}: {game['archetype']} ({game['condition']})")
        enrich_game(game)

        # Verify last move has features
        last = game["moves"][-1]
        print(f"  Last move white_features: {last.get('white_features', 'MISSING')}")

    with open(presets_path, "w") as f:
        json.dump(presets, f)

    print(f"\nDone. Enriched {len(presets)} games, written to {presets_path}")
    size_kb = presets_path.stat().st_size / 1024
    print(f"File size: {size_kb:.0f} KB")


if __name__ == "__main__":
    main()
