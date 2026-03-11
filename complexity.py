import chess
import chess.engine
from archetypes import PIECE_VALUES

_cache = {}


def _material_total(board: chess.Board) -> int:
    total = 0
    for sq in chess.SQUARES:
        pc = board.piece_at(sq)
        if pc and pc.piece_type != chess.KING:
            total += PIECE_VALUES[pc.piece_type]
    return total


def _starting_material() -> int:
    return _material_total(chess.Board())


_START_MAT = _starting_material()


def _eval_spread(engine: chess.engine.SimpleEngine, board: chess.Board, depth: int = 12) -> float:
    """How many 'reasonable' moves exist? Narrow spread = complex decision."""
    info = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=4)
    if len(info) < 2:
        return 0.0

    scores = []
    for entry in info:
        sc = entry["score"].pov(board.turn)
        if sc.is_mate():
            scores.append(3000 if sc.mate() > 0 else -3000)
        else:
            scores.append(sc.score())

    spread = abs(scores[0] - scores[-1])
    # Narrow spread → high complexity (many viable moves)
    return 1.0 - min(spread / 300.0, 1.0)


def _tactical_tension(board: chess.Board) -> float:
    """Count attacked-but-undefended pieces and pins."""
    tension = 0
    for sq in chess.SQUARES:
        pc = board.piece_at(sq)
        if pc is None:
            continue

        color = pc.color
        enemy = not color

        attacked_by_enemy = bool(board.attackers(enemy, sq))
        defended_by_own = bool(board.attackers(color, sq))

        if attacked_by_enemy and not defended_by_own and pc.piece_type != chess.KING:
            tension += 1

        if board.is_pinned(color, sq):
            tension += 0.5

    return min(tension / 6.0, 1.0)


def _material_imbalance(board: chess.Board) -> float:
    """How far is the board from starting material? Sacrifices and captures create imbalance."""
    current = _material_total(board)
    lost = _START_MAT - current
    return min(lost / 2000.0, 1.0)


def compute_complexity(engine: chess.engine.SimpleEngine, board: chess.Board, depth: int = 12) -> float:
    """
    Position complexity score in [0, 1].
    Higher = harder for humans to navigate correctly.
    """
    fen = board.fen()
    if fen in _cache:
        return _cache[fen]

    spread = _eval_spread(engine, board, depth)
    tension = _tactical_tension(board)
    imbalance = _material_imbalance(board)

    score = 0.5 * spread + 0.3 * tension + 0.2 * imbalance
    _cache[fen] = round(score, 4)
    return _cache[fen]


def clear_cache():
    _cache.clear()
