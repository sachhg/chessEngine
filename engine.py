import random
import shutil

import chess
import chess.engine

from archetypes import (
    Archetype, COUNTER_PARAMS, COUNTER_BEHAVIOR, PROXY_CONFIGS, PIECE_VALUES,
)


def find_stockfish() -> str:
    path = shutil.which("stockfish")
    if path:
        return path
    raise FileNotFoundError(
        "Stockfish not found in PATH. Install it:\n"
        "  macOS:  brew install stockfish\n"
        "  Linux:  sudo apt install stockfish\n"
        "  Or download from https://stockfishchess.org/download/"
    )


SF_PATH = find_stockfish()


def _material_on_board(board: chess.Board) -> int:
    total = 0
    for sq in chess.SQUARES:
        pc = board.piece_at(sq)
        if pc and pc.piece_type != chess.KING:
            total += PIECE_VALUES[pc.piece_type]
    return total


def _detect_phase(board: chess.Board) -> str:
    mat = _material_on_board(board)
    if board.fullmove_number <= 10 and mat > 6000:
        return "opening"
    if mat > 3000:
        return "middlegame"
    return "endgame"


def _is_capture(board: chess.Board, move: chess.Move) -> bool:
    return board.is_capture(move)


def _capture_value(board: chess.Board, move: chess.Move) -> int:
    victim = board.piece_at(move.to_square)
    if victim is None:
        # en passant
        if board.is_en_passant(move):
            return PIECE_VALUES[chess.PAWN]
        return 0
    return PIECE_VALUES[victim.piece_type]


def _aggression_score(board: chess.Board, move: chess.Move) -> float:
    """Score a move by how aggressive it is."""
    sc = 0.0
    board_copy = board.copy()
    board_copy.push(move)

    if board_copy.is_check():
        sc += 2.0

    pc = board.piece_at(move.from_square)
    if pc is None:
        return sc

    # Advancement toward opponent back rank
    if pc.color == chess.WHITE:
        advancement = chess.square_rank(move.to_square) - chess.square_rank(move.from_square)
    else:
        advancement = chess.square_rank(move.from_square) - chess.square_rank(move.to_square)
    sc += advancement * 0.3

    # Attacking squares near opponent king
    opp_king_sq = board.king(not pc.color)
    if opp_king_sq is not None:
        dist = chess.square_distance(move.to_square, opp_king_sq)
        if dist <= 2:
            sc += (3 - dist) * 0.5

    return sc


def _is_quiet_move(board: chess.Board, move: chess.Move) -> bool:
    if board.is_capture(move):
        return False
    board_copy = board.copy()
    board_copy.push(move)
    if board_copy.is_check():
        return False
    pc = board.piece_at(move.from_square)
    if pc and pc.piece_type == chess.PAWN:
        # Pawn pushes beyond the 4th rank are not quiet
        rank = chess.square_rank(move.to_square)
        if (pc.color == chess.WHITE and rank >= 4) or (pc.color == chess.BLACK and rank <= 3):
            return False
    return True


class AdaptiveEngine:
    """
    Wraps Stockfish with two modes:
    - Adaptive mode: tunes UCI params to exploit opponent archetype
    - Proxy mode: plays *as* an archetype for simulation
    """

    def __init__(self, archetype: Archetype = None, proxy_mode: bool = False):
        self.engine = chess.engine.SimpleEngine.popen_uci(SF_PATH)
        self.archetype = archetype
        self.proxy_mode = proxy_mode
        self.move_log = []

        if proxy_mode and archetype:
            self.engine.configure(PROXY_CONFIGS[archetype])
        elif not proxy_mode and archetype:
            self.engine.configure(COUNTER_PARAMS[archetype])

    def pick_move(self, board: chess.Board, time_limit: float = 0.3) -> dict:
        phase = _detect_phase(board)
        limit = chess.engine.Limit(time=time_limit)

        if self.proxy_mode:
            return self._proxy_pick(board, limit, phase)
        else:
            return self._adaptive_pick(board, limit, phase)

    def _adaptive_pick(self, board: chess.Board, limit: chess.engine.Limit, phase: str) -> dict:
        """Pick a move using the counter-strategy."""
        # Use MultiPV selection in the middlegame when we have a counter-behavior defined
        use_multipv = (
            phase == "middlegame"
            and self.archetype is not None
            and self.archetype in COUNTER_BEHAVIOR
        )

        if use_multipv:
            info_list = self.engine.analyse(board, limit, multipv=3)
            move = self._select_counter_move(board, info_list)
            top_score = info_list[0]["score"].pov(board.turn)
        else:
            result = self.engine.play(board, limit, info=chess.engine.INFO_SCORE)
            move = result.move
            top_score = result.info.get("score", chess.engine.PovScore(chess.engine.Cp(0), board.turn)).pov(board.turn)

        eval_cp = top_score.score(mate_score=10000)
        entry = {
            "move": move,
            "uci": move.uci(),
            "san": board.san(move),
            "phase": phase,
            "eval": eval_cp,
        }
        self.move_log.append(entry)
        return entry

    def _select_counter_move(self, board: chess.Board, info_list: list) -> chess.Move:
        """Among MultiPV candidates, pick the one that best exploits the opponent."""
        if len(info_list) == 1:
            return info_list[0]["pv"][0]

        behavior = COUNTER_BEHAVIOR.get(self.archetype, {})
        tolerance = behavior.get("sacrifice_tolerance", 50)
        aggression = behavior.get("aggression", 0)

        top_score = info_list[0]["score"].pov(board.turn)
        top_cp = top_score.score(mate_score=10000)

        # If we're already clearly winning, just play the best move
        if top_cp > 200:
            return info_list[0]["pv"][0]

        if self.archetype == Archetype.MATERIALISTIC:
            # Look for a sacrifice: material goes down but eval stays close.
            # Materialistic opponents don't know how to handle being offered material.
            for entry in info_list[1:]:
                mv = entry["pv"][0]
                cp = entry["score"].pov(board.turn).score(mate_score=10000)
                if abs(top_cp - cp) < tolerance:
                    mat_before = _material_on_board(board)
                    sim = board.copy()
                    sim.push(mv)
                    mat_after = _material_on_board(sim)
                    if mat_before - mat_after > 50:
                        return mv

        elif self.archetype == Archetype.PASSIVE:
            # Prefer moves that open the position — captures, pawn breaks
            for entry in info_list:
                mv = entry["pv"][0]
                cp = entry["score"].pov(board.turn).score(mate_score=10000)
                if abs(top_cp - cp) < tolerance and board.is_capture(mv):
                    return mv

        elif self.archetype == Archetype.TACTICAL:
            # Against tactical players: prefer simplifying trades
            for entry in info_list:
                mv = entry["pv"][0]
                cp = entry["score"].pov(board.turn).score(mate_score=10000)
                if abs(top_cp - cp) < tolerance:
                    sim = board.copy()
                    sim.push(mv)
                    if _material_on_board(sim) < _material_on_board(board) - 200:
                        return mv

        elif self.archetype == Archetype.AGGRESSIVE:
            # Against aggressive players: prefer solid, defensive positions
            quiet = [e for e in info_list
                     if _is_quiet_move(board, e["pv"][0])
                     and abs(top_cp - e["score"].pov(board.turn).score(mate_score=10000)) < tolerance]
            if quiet:
                return quiet[0]["pv"][0]

        elif self.archetype == Archetype.POSITIONAL:
            # Against positional players: inject imbalances
            for entry in info_list:
                mv = entry["pv"][0]
                cp = entry["score"].pov(board.turn).score(mate_score=10000)
                agg = _aggression_score(board, mv)
                if abs(top_cp - cp) < tolerance and agg > 1.0:
                    return mv

        return info_list[0]["pv"][0]

    def _proxy_pick(self, board: chess.Board, limit: chess.engine.Limit, phase: str) -> dict:
        """Play as the archetype — biased move selection."""
        info_list = self.engine.analyse(board, limit, multipv=3)

        # 10% chance of random candidate (human imperfection)
        if random.random() < 0.10 and len(info_list) > 1:
            entry = random.choice(info_list)
            move = entry["pv"][0]
        else:
            move = self._select_proxy_move(board, info_list)

        top_score = info_list[0]["score"].pov(board.turn)
        eval_cp = top_score.score(mate_score=10000)

        entry = {
            "move": move,
            "uci": move.uci(),
            "san": board.san(move),
            "phase": phase,
            "eval": eval_cp,
        }
        self.move_log.append(entry)
        return entry

    def _select_proxy_move(self, board: chess.Board, info_list: list) -> chess.Move:
        candidates = [e["pv"][0] for e in info_list]
        top_cp = info_list[0]["score"].pov(board.turn).score(mate_score=10000)

        if self.archetype == Archetype.MATERIALISTIC:
            # Greedily capture the highest-value piece
            captures = [(m, _capture_value(board, m)) for m in candidates if _is_capture(board, m)]
            if captures:
                captures.sort(key=lambda x: x[1], reverse=True)
                return captures[0][0]

        elif self.archetype == Archetype.AGGRESSIVE:
            scored = [(m, _aggression_score(board, m)) for m in candidates]
            scored.sort(key=lambda x: x[1], reverse=True)
            return scored[0][0]

        elif self.archetype == Archetype.PASSIVE:
            quiet = [m for m in candidates if _is_quiet_move(board, m)]
            if quiet:
                return quiet[0]

        elif self.archetype == Archetype.TACTICAL:
            # Prefer the engine's top choice (tactical players play strong moves)
            pass

        elif self.archetype == Archetype.POSITIONAL:
            # Prefer central moves
            central = chess.SquareSet([chess.D4, chess.D5, chess.E4, chess.E5,
                                       chess.C3, chess.C4, chess.C5, chess.C6,
                                       chess.F3, chess.F4, chess.F5, chess.F6])
            center_moves = [m for m in candidates if m.to_square in central]
            if center_moves:
                return center_moves[0]

        return candidates[0]

    def get_eval(self, board: chess.Board, depth: int = 12) -> float:
        info = self.engine.analyse(board, chess.engine.Limit(depth=depth))
        sc = info["score"].pov(board.turn)
        return sc.score(mate_score=10000) / 100.0

    def close(self):
        try:
            self.engine.quit()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
