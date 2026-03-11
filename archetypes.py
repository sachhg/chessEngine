from enum import Enum


class Archetype(Enum):
    AGGRESSIVE = "aggressive"
    MATERIALISTIC = "materialistic"
    POSITIONAL = "positional"
    TACTICAL = "tactical"
    PASSIVE = "passive"


# UCI params to *counter* each archetype.
# Applied to the adaptive engine when playing against a profiled opponent.
# Note: Stockfish 16+ removed Contempt. Strategy shifts are handled
# via MultiPV move selection in engine.py instead of UCI params.
COUNTER_PARAMS = {
    Archetype.AGGRESSIVE: {
        "Skill Level": 20,
        "Move Overhead": 50,
        # Play solid, absorb the attack, punish overextension.
    },
    Archetype.MATERIALISTIC: {
        "Skill Level": 20,
        # Push for imbalances. Offer poisoned material via MultiPV selection.
    },
    Archetype.POSITIONAL: {
        "Skill Level": 20,
        # Inject tactical chaos into slow maneuvering games.
    },
    Archetype.TACTICAL: {
        "Skill Level": 20,
        # Simplify. Trade pieces. Starve them of complications.
    },
    Archetype.PASSIVE: {
        "Skill Level": 20,
        # Maximum pressure. They won't fight back.
    },
}

# Behavioral bias weights for MultiPV move selection.
# These replace the old Contempt-based tuning.
# aggression: >0 = prefer sharp/attacking moves, <0 = prefer safe/quiet moves
# sacrifice_tolerance: how much eval we're willing to sacrifice for positional pressure
COUNTER_BEHAVIOR = {
    Archetype.AGGRESSIVE: {"aggression": -0.5, "sacrifice_tolerance": 30},
    Archetype.MATERIALISTIC: {"aggression": 0.6, "sacrifice_tolerance": 80},
    Archetype.POSITIONAL: {"aggression": 0.4, "sacrifice_tolerance": 50},
    Archetype.TACTICAL: {"aggression": -0.3, "sacrifice_tolerance": 20},
    Archetype.PASSIVE: {"aggression": 0.8, "sacrifice_tolerance": 60},
}

# UCI params to make Stockfish *behave like* each archetype.
# Used to create proxy opponents for simulation.
# Behavioral differentiation comes from MultiPV move selection in engine.py.
PROXY_CONFIGS = {
    Archetype.AGGRESSIVE: {
        "UCI_LimitStrength": True,
        "UCI_Elo": 1800,
        "Skill Level": 12,
    },
    Archetype.MATERIALISTIC: {
        "UCI_LimitStrength": True,
        "UCI_Elo": 1900,
        "Skill Level": 14,
    },
    Archetype.POSITIONAL: {
        "UCI_LimitStrength": True,
        "UCI_Elo": 1850,
        "Skill Level": 13,
    },
    Archetype.TACTICAL: {
        "UCI_LimitStrength": True,
        "UCI_Elo": 1800,
        "Skill Level": 12,
    },
    Archetype.PASSIVE: {
        "UCI_LimitStrength": True,
        "UCI_Elo": 1750,
        "Skill Level": 11,
    },
}

# Piece values in centipawns for material calculations
PIECE_VALUES = {1: 100, 2: 320, 3: 330, 4: 500, 5: 900, 6: 0}
# pawn, knight, bishop, rook, queen, king

# Feature centroids for archetype classification.
# Each key maps to the "ideal" normalized feature vector for that style.
# Profiler classifies by nearest centroid (Euclidean distance).
# Calibrated against actual proxy engine output.
# Realistic feature ranges: greed 0.10-0.25, advancement 0.12-0.30,
# king_pressure 0.01-0.16, center 0.27-0.45, pawn_storm 0.04-0.14
CENTROIDS = {
    Archetype.AGGRESSIVE: {
        "material_greed": 0.21,
        "sacrifice_rate": 0.005,
        "avg_piece_advancement": 0.22,
        "king_pressure_index": 0.11,
        "center_control": 0.42,
        "pawn_storm_frequency": 0.13,
        "trade_when_ahead": 0.00,
        "complexity_preference": 0.40,
    },
    Archetype.MATERIALISTIC: {
        "material_greed": 0.20,
        "sacrifice_rate": 0.000,
        "avg_piece_advancement": 0.25,
        "king_pressure_index": 0.14,
        "center_control": 0.32,
        "pawn_storm_frequency": 0.09,
        "trade_when_ahead": 0.00,
        "complexity_preference": 0.38,
    },
    Archetype.POSITIONAL: {
        "material_greed": 0.16,
        "sacrifice_rate": 0.000,
        "avg_piece_advancement": 0.25,
        "king_pressure_index": 0.07,
        "center_control": 0.44,
        "pawn_storm_frequency": 0.11,
        "trade_when_ahead": 0.00,
        "complexity_preference": 0.28,
    },
    Archetype.TACTICAL: {
        "material_greed": 0.17,
        "sacrifice_rate": 0.000,
        "avg_piece_advancement": 0.30,
        "king_pressure_index": 0.16,
        "center_control": 0.29,
        "pawn_storm_frequency": 0.04,
        "trade_when_ahead": 0.05,
        "complexity_preference": 0.37,
    },
    Archetype.PASSIVE: {
        "material_greed": 0.10,
        "sacrifice_rate": 0.000,
        "avg_piece_advancement": 0.12,
        "king_pressure_index": 0.01,
        "center_control": 0.28,
        "pawn_storm_frequency": 0.10,
        "trade_when_ahead": 0.00,
        "complexity_preference": 0.16,
    },
}

# Radar chart display labels
FEATURE_LABELS = {
    "material_greed": "Material Greed",
    "sacrifice_rate": "Sacrifice Rate",
    "avg_piece_advancement": "Piece Activity",
    "king_pressure_index": "King Pressure",
    "center_control": "Center Control",
    "pawn_storm_frequency": "Pawn Storms",
    "trade_when_ahead": "Trades When Ahead",
    "complexity_preference": "Complexity Pref.",
}
