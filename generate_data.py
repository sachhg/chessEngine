#!/usr/bin/env python3
"""
Generate synthetic PGN games using proxy-archetype Stockfish engines.
Produces clean archetype-labeled data for profiler validation and demo caching.
"""
import sys
import chess
import chess.pgn
from datetime import datetime
from io import StringIO

from archetypes import Archetype
from engine import AdaptiveEngine

GAMES_PER_ARCHETYPE = 8
TIME_PER_MOVE = 0.2
MAX_MOVES = 120


def generate_games(archetype: Archetype, n: int = GAMES_PER_ARCHETYPE) -> list:
    """Play n games where the archetype proxy plays against default Stockfish."""
    games = []
    for i in range(n):
        proxy = AdaptiveEngine(archetype=archetype, proxy_mode=True)
        opponent = AdaptiveEngine(archetype=None, proxy_mode=False)

        proxy_is_white = (i % 2 == 0)
        board = chess.Board()

        game = chess.pgn.Game()
        game.headers["Event"] = "Synthetic PDSO Data"
        game.headers["Date"] = datetime.now().strftime("%Y.%m.%d")
        game.headers["Round"] = str(i + 1)
        game.headers["White"] = f"{archetype.value}_proxy" if proxy_is_white else "Stockfish"
        game.headers["Black"] = "Stockfish" if proxy_is_white else f"{archetype.value}_proxy"

        node = game
        try:
            while not board.is_game_over() and board.fullmove_number < MAX_MOVES:
                is_proxy_turn = (board.turn == chess.WHITE) == proxy_is_white
                if is_proxy_turn:
                    data = proxy.pick_move(board, time_limit=TIME_PER_MOVE)
                else:
                    data = opponent.pick_move(board, time_limit=TIME_PER_MOVE)

                move = data["move"]
                node = node.add_variation(move)
                board.push(move)

            game.headers["Result"] = board.result()
        finally:
            proxy.close()
            opponent.close()

        games.append(game)
        sys.stdout.write(f"\r  {archetype.value}: {i+1}/{n} games")
        sys.stdout.flush()

    print()
    return games


def main():
    all_games = []
    for arch in Archetype:
        print(f"Generating {GAMES_PER_ARCHETYPE} games for {arch.value}...")
        games = generate_games(arch)
        all_games.extend(games)

    outpath = "data/synthetic.pgn"
    with open(outpath, "w") as f:
        for g in all_games:
            print(g, file=f)
            print(file=f)

    print(f"\nWrote {len(all_games)} games to {outpath}")


if __name__ == "__main__":
    main()
