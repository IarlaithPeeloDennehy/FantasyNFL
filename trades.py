"""Phase 1 validation fixtures.

A baseline roster and a set of trades against it. The `expected` field is a
judgement call about what an experienced player would say -- REPLACE THESE WITH
YOUR OWN before treating the pass rate as meaningful. The plan's gate is that the
model agrees with *your* gut on at least 8 of 10.

expected is one of: "gain", "loss", "even".
`min_per_week` / `max_per_week` are optional magnitude expectations.
"""

# A deliberately lopsided roster: deep at receiver, thin at running back.
# Trades read differently against roster context, which is the whole point of
# grading at the lineup level.
ROSTER = [
    "Joe Burrow",
    "Bo Nix",
    "Kyren Williams",
    "Javonte Williams",
    "Rico Dowdle",
    "Chuba Hubbard",
    "Jaylen Warren",
    "Ja'Marr Chase",
    "Nico Collins",
    "Zay Flowers",
    "Rome Odunze",
    "Jameson Williams",
    "Josh Downs",
    "Michael Wilson",
    "Trey McBride",
]

TRADES = [
    {
        "id": "consolidation-up",
        "note": "Two surplus receivers for an elite back, on an RB-thin roster.",
        "give": ["Nico Collins", "Rome Odunze"],
        "receive": ["Jahmyr Gibbs"],
        "expected": "gain",
        "min_per_week": 2.0,
    },
    {
        "id": "consolidation-trap",
        "note": "THE KEY TEST. Elite WR out, two good WRs in, on a WR-deep roster. "
                "A sum-of-values model says the two-player side wins. It should not.",
        "give": ["Ja'Marr Chase"],
        "receive": ["Chris Olave", "Rashee Rice"],
        "expected": "loss",
    },
    {
        "id": "obvious-robbery",
        "note": "Bench receiver for a top-five back. Should be lopsided.",
        "give": ["Michael Wilson"],
        "receive": ["Bijan Robinson"],
        "expected": "gain",
        "min_per_week": 5.0,
    },
    {
        "id": "obvious-fleecing",
        "note": "Elite tight end for a fringe one. Should be a clear loss.",
        "give": ["Trey McBride"],
        "receive": ["Kyle Pitts Sr."],
        "expected": "loss",
        "min_per_week": 2.0,
    },
    {
        "id": "even-swap",
        "note": "Adjacent receivers. Should read as essentially even.",
        "give": ["Zay Flowers"],
        "receive": ["Garrett Wilson"],
        "expected": "even",
    },
    {
        "id": "identity",
        "note": "Sanity check: a player for himself must be exactly zero.",
        "give": ["Zay Flowers"],
        "receive": ["Zay Flowers"],
        "expected": "even",
        "max_per_week": 0.001,
    },
    {
        "id": "three-for-one",
        "note": "Three non-starters for one elite starter. Should be a clear gain.",
        "give": ["Josh Downs", "Michael Wilson", "Chuba Hubbard"],
        "receive": ["Puka Nacua"],
        "expected": "gain",
        "min_per_week": 2.0,
    },
    {
        "id": "bench-shuffle",
        "note": "Two players who would never start, swapped. Lineup should not move.",
        "give": ["Michael Wilson"],
        "receive": ["Alec Pierce"],
        "expected": "even",
    },
    {
        "id": "starter-for-depth",
        "note": "Giving up a starting RB for receiver depth the roster does not need.",
        "give": ["Kyren Williams"],
        "receive": ["Quentin Johnston", "Wan'Dale Robinson"],
        "expected": "loss",
    },
    {
        "id": "positional-scarcity",
        "note": "Elite TE for a similarly-ranked WR. On a WR-deep roster the TE is "
                "worth more, because replacement level at TE is dire.",
        "give": ["Trey McBride"],
        "receive": ["Tee Higgins"],
        "expected": "loss",
    },
    {
        "id": "qb-for-wr-1qb",
        "note": "Elite QB out, elite WR in, on a roster that is already deep at "
                "receiver and has a real backup QB. In the abstract the WR is worth "
                "more; against THIS roster the incoming WR barely cracks the lineup "
                "while the QB slot takes a real hit. Roster context beats abstract "
                "value, which is the argument for grading lineups.",
        "give": ["Joe Burrow"],
        "receive": ["Malik Nabers"],
        "expected": "loss",
    },
    {
        "id": "upgrade-rb2",
        "note": "The plan's worked example: middling RB2 becomes a good one.",
        "give": ["Javonte Williams"],
        "receive": ["Chase Brown"],
        "expected": "gain",
        "min_per_week": 2.0,
    },
]

# Properties of the value model itself, independent of any roster. These are the
# claims the app makes that users find counterintuitive, so they are worth
# asserting directly rather than inferring from a trade.
VALUE_ASSERTIONS = [
    {
        "id": "wr1-beats-qb1-in-1qb",
        "note": "The socially explosive one. In a 1QB league the best receiver is "
                "worth more than the best quarterback, because QB replacement level "
                "is so high. If this fails, the scarcity model is broken.",
        "league": "1qb",
        "claim": ("vor", "WR", 1, ">", "QB", 1),
    },
    {
        "id": "qb1-beats-wr1-in-superflex",
        "note": "And it must flip in superflex. Same data file, different league.",
        "league": "superflex",
        "claim": ("vor", "QB", 1, ">", "WR", 1),
    },
    {
        "id": "te1-beats-same-ranked-wr",
        "note": "Tight end scarcity: TE1 should out-value the WR at the same overall "
                "consensus rank, because replacement level at TE is dire.",
        "league": "1qb",
        "claim": ("vor", "TE", 1, ">", "WR", 12),
    },
    {
        "id": "deeper-league-raises-value",
        "note": "A 14-team league has a worse replacement level than a 10-team one, "
                "so every startable player is worth more in the deeper league.",
        "league": "deep-vs-shallow",
        "claim": ("league-depth", "RB", 5),
    },
]

# Graded in several formats to show the model is league-aware rather than baking
# one league's assumptions into the data file.
#
# An earlier draft of this note claimed the verdict should *flip* in superflex.
# It does not, and it should not: this roster's QB2 is Bo Nix, so in superflex
# Burrow and Nix are both starting. Trading Burrow does not just downgrade the QB
# slot, it empties a second one. Giving up an elite QB in superflex is strictly
# worse than in 1QB, and the model saying so is the model being right. What is
# worth asserting is the direction of the *gap*, not a flip.
FORMAT_SENSITIVITY = {
    "id": "qb-for-wr-superflex",
    "note": "The same QB-for-WR trade across formats. Superflex must hurt more "
            "than 1QB, because in superflex the QB you trade away was filling two "
            "slots' worth of scarcity rather than one.",
    "give": ["Joe Burrow"],
    "receive": ["Malik Nabers"],
    # Checked, not just printed: superflex delta must be materially worse.
    "expect": {"superflex_worse_than_1qb_by": 1.0},
}
