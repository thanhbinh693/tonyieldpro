import math
import random


N_PLAYERS = 5
MAX_CREATOR_WIN_RATE = 0.9999
ROUND_DIGITS = 6


def _clamp_rate(value):
    try:
        rate = float(value)
    except (TypeError, ValueError):
        rate = 0.0
    return min(MAX_CREATOR_WIN_RATE, max(0.0, rate))


def _round(value):
    return round(float(value), ROUND_DIGITS)


def compute_mine_probability(creator_win_rate, n=N_PLAYERS):
    creator_win_rate = _clamp_rate(creator_win_rate)
    n = max(1, int(n))

    p_mine = 1 - (1 - creator_win_rate) ** (1 / n)
    q_safe = 1 - p_mine

    distribution = {}
    for k in range(n + 1):
        probability = math.comb(n, k) * (p_mine ** k) * (q_safe ** (n - k))
        distribution[k] = _round(probability)

    player_win_probs = [_round(q_safe) for _ in range(n)]
    verified_creator_win = 1 - (q_safe ** n)

    return {
        "p_mine": _round(p_mine),
        "q_safe": _round(q_safe),
        "distribution": distribution,
        "player_win_probs": player_win_probs,
        "verified_creator_win": _round(verified_creator_win),
    }


def run_round(creator_win_rate):
    probability = compute_mine_probability(creator_win_rate, N_PLAYERS)
    p_mine = probability["p_mine"]

    players = []
    mine_count = 0
    for index in range(N_PLAYERS):
        hit_mine = random.random() < p_mine
        if hit_mine:
            mine_count += 1
        players.append({
            "player": index + 1,
            "result": "mine" if hit_mine else "safe",
            "win": not hit_mine,
        })

    return {
        "players": players,
        "mine_count": mine_count,
        "creator_wins": mine_count > 0,
        "probability": probability,
    }
