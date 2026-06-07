"""
stake_board_math.py
───────────────────
Math SDK para Stake Engine — Stake Board Game
Versión: 1.0.0

Estructura del juego:
  - Tablero 4×4 = 16 casillas independientes
  - Cada casilla es una apuesta stateless (RPS + evento especial)
  - La racha (streak) la trackea el FRONTEND y se pasa como parámetro
  - El RGS solo recibe: (bet, streak_at_bet_time) → devuelve payout

Requisitos: Python >= 3.12
"""

from __future__ import annotations
import random
import json
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict


# ─────────────────────────────────────────────
# 1. CONSTANTES Y PARÁMETROS DEL JUEGO
# ─────────────────────────────────────────────

HOUSE_EDGE          = 0.72   # multiplicador base sobre la apuesta en victoria
STREAK_STEP         = 0.04   # incremento del multiplicador por cada victoria en racha
STREAK_CAP          = 16     # máxima racha que afecta al multiplicador (x1.64 max)

# Probabilidades de eventos especiales (deben sumar < 1.0)
EVENT_PROBABILITIES: dict[str, float] = {
    "DOUBLE_WIN":    0.05,   # ×1.60 sobre apuesta
    "TRIPLE_WIN":    0.04,   # ×2.40 sobre apuesta
    "INSTANT_RACHA": 0.06,   # streak +3, payout con (streakMult + 0.20)
    "LOSE_HALF":     0.08,   # derrota pero solo pierdes 50%, racha se conserva
    "RESET_RACHA":   0.07,   # derrota, pierdes 50% y racha → 0
    # resto (0.70) = ronda normal sin evento
}

assert sum(EVENT_PROBABILITIES.values()) < 1.0, "Suma de probabilidades de eventos debe ser < 1.0"

# RPS: probabilidad real de ganar (sin empates, que se re-juegan)
# P(win | no tie)  = 1/2 = 0.5
# P(tie)           = 1/3  → descartado, se vuelve a lanzar
P_WIN_GIVEN_NO_TIE = 1 / 2


# ─────────────────────────────────────────────
# 2. TIPOS DE DATOS
# ─────────────────────────────────────────────

class RPSMove(Enum):
    ROCK     = "piedra"
    PAPER    = "papel"
    SCISSORS = "tijeras"

class Outcome(Enum):
    WIN  = "win"
    LOSE = "lose"

@dataclass
class RoundResult:
    outcome:       Outcome
    event:         str | None        # clave del evento especial o None
    bet:           int               # en unidades mínimas (e.g. 1 = $0.000001)
    streak_before: int               # racha del jugador ANTES de esta ronda
    payout_delta:  int               # delta de balance (+ganancia / -pérdida)
    new_streak:    int               # racha tras la ronda
    rps_rounds:    int               # cuántas sub-rondas de RPS hasta decidir (empates incluidos)


# ─────────────────────────────────────────────
# 3. LÓGICA RPS
# ─────────────────────────────────────────────

BEATS: dict[RPSMove, RPSMove] = {
    RPSMove.ROCK:     RPSMove.SCISSORS,
    RPSMove.PAPER:    RPSMove.ROCK,
    RPSMove.SCISSORS: RPSMove.PAPER,
}

def rps_single_round() -> tuple[RPSMove, RPSMove, str]:
    """
    Lanza una sub-ronda de RPS.
    Devuelve (player_move, cpu_move, result) donde result ∈ {'win','lose','tie'}.
    """
    moves = list(RPSMove)
    player = random.choice(moves)
    cpu    = random.choice(moves)
    if player == cpu:
        return player, cpu, "tie"
    return player, cpu, ("win" if BEATS[player] == cpu else "lose")


def rps_until_winner() -> tuple[Outcome, int]:
    """
    Repite sub-rondas hasta que no haya empate.
    Devuelve (Outcome, num_sub_rounds_total).
    """
    sub_rounds = 0
    while True:
        sub_rounds += 1
        _, _, result = rps_single_round()
        if result != "tie":
            return Outcome.WIN if result == "win" else Outcome.LOSE, sub_rounds


# ─────────────────────────────────────────────
# 4. EVENTOS ESPECIALES
# ─────────────────────────────────────────────

def sample_event() -> str | None:
    """
    Muestrea un evento especial basado en sus probabilidades acumuladas.
    Devuelve la clave del evento o None si no hay evento.
    """
    r = random.random()
    cumulative = 0.0
    for event_key, prob in EVENT_PROBABILITIES.items():
        cumulative += prob
        if r < cumulative:
            return event_key
    return None


# ─────────────────────────────────────────────
# 5. TABLA DE PAGOS (PAYOUT TABLE)
# ─────────────────────────────────────────────

def streak_multiplier(streak: int) -> float:
    """
    Calcula el multiplicador de racha.
    streak_multiplier(0)  = 1.00  (sin racha)
    streak_multiplier(1)  = 1.08
    streak_multiplier(5)  = 1.40
    streak_multiplier(10) = 1.80
    streak_multiplier(16) = 2.28  (cap)
    """
    return 1.0 + min(streak, STREAK_CAP) * STREAK_STEP


def compute_payout(bet: int, outcome: Outcome, event: str | None, streak_before: int) -> int:
    """
    Calcula el delta de balance para una ronda.

    Parámetros
    ----------
    bet          : apuesta en unidades mínimas
    outcome      : Outcome.WIN o Outcome.LOSE
    event        : clave del evento especial activo, o None
    streak_before: victorias consecutivas del jugador ANTES de esta ronda

    Devuelve
    --------
    int : positivo = ganancia neta, negativo = pérdida neta
    """
    if outcome == Outcome.WIN:
        if event == "DOUBLE_WIN":
            return int(bet * 1.60)
        if event == "TRIPLE_WIN":
            return int(bet * 2.40)
        if event == "INSTANT_RACHA":
            mult = streak_multiplier(streak_before) + 0.20
            return int(bet * HOUSE_EDGE * mult)
        # victoria normal
        return int(bet * HOUSE_EDGE * streak_multiplier(streak_before))

    else:  # LOSE
        if event in ("LOSE_HALF", "RESET_RACHA"):
            return -int(bet * 0.50)
        return -bet


def update_streak(current_streak: int, outcome: Outcome, event: str | None) -> int:
    """
    Devuelve la nueva racha tras la ronda.
    La racha es estado del FRONTEND, no del RGS.
    Esta función es la referencia canónica de cómo debe actualizarla el cliente.
    """
    if outcome == Outcome.WIN:
        bonus = 3 if event == "INSTANT_RACHA" else 1
        return current_streak + bonus
    else:
        # LOSE_HALF conserva la racha; el resto la resetea
        if event == "LOSE_HALF":
            return current_streak
        return 0


# ─────────────────────────────────────────────
# 6. RONDA COMPLETA
# ─────────────────────────────────────────────

def play_round(bet: int, streak_before: int) -> RoundResult:
    """
    Simula una ronda completa del juego:
      1. Sortea evento especial
      2. Juega RPS hasta decidir
      3. Calcula payout
      4. Actualiza racha

    Parámetros
    ----------
    bet          : apuesta en unidades mínimas (>0)
    streak_before: racha actual del jugador antes de apostar

    Devuelve
    --------
    RoundResult con todos los detalles de la ronda
    """
    assert bet > 0, "La apuesta debe ser > 0"
    assert streak_before >= 0, "La racha no puede ser negativa"

    event             = sample_event()
    outcome, sub_rounds = rps_until_winner()
    payout_delta      = compute_payout(bet, outcome, event, streak_before)
    new_streak        = update_streak(streak_before, outcome, event)

    return RoundResult(
        outcome       = outcome,
        event         = event,
        bet           = bet,
        streak_before = streak_before,
        payout_delta  = payout_delta,
        new_streak    = new_streak,
        rps_rounds    = sub_rounds,
    )


# ─────────────────────────────────────────────
# 7. SIMULACIÓN MASIVA Y CÁLCULO DE RTP
# ─────────────────────────────────────────────

@dataclass
class SimulationStats:
    n_rounds:          int   = 0
    total_bet:         int   = 0
    total_payout:      int   = 0
    wins:              int   = 0
    losses:            int   = 0
    events_triggered:  dict  = field(default_factory=lambda: defaultdict(int))
    max_streak:        int   = 0
    total_rps_rounds:  int   = 0   # sub-rondas totales (incluyendo empates)

    @property
    def rtp(self) -> float:
        """Return-to-Player como fracción (e.g. 0.934 = 93.4%)"""
        if self.total_bet == 0:
            return 0.0
        # total_payout aquí es la suma de ganancias netas (puede ser negativo)
        # RTP = (total_bet + total_net) / total_bet = 1 + net/bet
        return 1.0 + self.total_payout / self.total_bet

    @property
    def avg_rps_rounds_per_bet(self) -> float:
        return self.total_rps_rounds / max(self.n_rounds, 1)

    def summary(self) -> dict:
        return {
            "n_rounds":               self.n_rounds,
            "rtp_%":                  round(self.rtp * 100, 4),
            "win_rate_%":             round(self.wins / max(self.n_rounds, 1) * 100, 4),
            "loss_rate_%":            round(self.losses / max(self.n_rounds, 1) * 100, 4),
            "avg_rps_rounds_per_bet": round(self.avg_rps_rounds_per_bet, 4),
            "max_streak_seen":        self.max_streak,
            "events_triggered":       dict(self.events_triggered),
        }


def simulate(
    n_rounds:      int = 1_000_000,
    bet:           int = 1_000_000,   # unidades mínimas (= $1.00)
    streak_policy: str = "reset",     # "reset" = racha siempre empieza en 0, "carry" = se acumula
) -> SimulationStats:
    """
    Simula n_rounds rondas y devuelve estadísticas agregadas.

    streak_policy:
      "reset" → cada ronda asume streak=0 (peor caso para el jugador, más conservador)
      "carry" → la racha se acumula sesión a sesión (más realista)
    """
    stats   = SimulationStats()
    streak  = 0

    for _ in range(n_rounds):
        s_before = streak if streak_policy == "carry" else 0
        result   = play_round(bet, s_before)

        stats.n_rounds         += 1
        stats.total_bet        += bet
        stats.total_payout     += result.payout_delta
        stats.total_rps_rounds += result.rps_rounds

        if result.outcome == Outcome.WIN:
            stats.wins += 1
        else:
            stats.losses += 1

        if result.event:
            stats.events_triggered[result.event] += 1

        streak = result.new_streak
        if streak > stats.max_streak:
            stats.max_streak = streak

    return stats


# ─────────────────────────────────────────────
# 8. GENERADOR DE LOOKUP TABLE (para Stake Engine)
# ─────────────────────────────────────────────

def generate_lookup_table(output_path: str = "lookup_table.json") -> None:
    """
    Genera la tabla de resultados precalculados en el formato que espera
    el RGS de Stake Engine.

    Cada entrada codifica:
      - outcome (win/lose)
      - event (o null)
      - streak_before (0..STREAK_CAP)
      - payout_multiplier (sobre la apuesta base)
      - probability (peso relativo)

    El RGS selecciona una entrada aleatoriamente ponderada por probability.
    """
    P_WIN  = P_WIN_GIVEN_NO_TIE                  # 0.5
    P_LOSE = 1.0 - P_WIN_GIVEN_NO_TIE            # 0.5

    entries = []

    for streak in range(STREAK_CAP + 1):
        for event_key, event_prob in EVENT_PROBABILITIES.items():
            is_win_event  = event_key in ("DOUBLE_WIN", "TRIPLE_WIN", "INSTANT_RACHA")
            is_lose_event = event_key in ("LOSE_HALF", "RESET_RACHA")

            if is_win_event:
                outcome = "win"
                base_p  = P_WIN * event_prob
                payout  = compute_payout(1_000_000, Outcome.WIN, event_key, streak) / 1_000_000
            elif is_lose_event:
                outcome = "lose"
                base_p  = P_LOSE * event_prob
                payout  = compute_payout(1_000_000, Outcome.LOSE, event_key, streak) / 1_000_000
            else:
                continue  # manejado abajo como ronda normal

            entries.append({
                "streak_before":     streak,
                "outcome":           outcome,
                "event":             event_key,
                "payout_multiplier": round(payout, 6),
                "probability":       round(base_p, 8),
            })

        # Ronda normal (sin evento)
        p_no_event = 1.0 - sum(EVENT_PROBABILITIES.values())

        win_payout  = compute_payout(1_000_000, Outcome.WIN,  None, streak) / 1_000_000
        lose_payout = compute_payout(1_000_000, Outcome.LOSE, None, streak) / 1_000_000

        entries.append({
            "streak_before":     streak,
            "outcome":           "win",
            "event":             None,
            "payout_multiplier": round(win_payout, 6),
            "probability":       round(P_WIN * p_no_event, 8),
        })
        entries.append({
            "streak_before":     streak,
            "outcome":           "lose",
            "event":             None,
            "payout_multiplier": round(lose_payout, 6),
            "probability":       round(P_LOSE * p_no_event, 8),
        })

    table = {
        "game_id":          "stake_board_v1",
        "version":          "1.0.0",
        "rtp_target_%":     93.0,
        "streak_cap":       STREAK_CAP,
        "streak_step":      STREAK_STEP,
        "house_edge":       HOUSE_EDGE,
        "total_entries":    len(entries),
        "entries":          entries,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(table, f, indent=2, ensure_ascii=False)

    print(f"✅ Lookup table generada: {output_path} ({len(entries)} entradas)")


# ─────────────────────────────────────────────
# 9. VERIFICACIÓN DE RTP POR STREAK
# ─────────────────────────────────────────────

def rtp_by_streak() -> None:
    """
    Muestra el RTP teórico para cada nivel de racha.
    Útil para verificar que la ventaja de la casa se mantiene razonable.
    """
    P_WIN      = P_WIN_GIVEN_NO_TIE
    P_LOSE     = 1 - P_WIN
    p_no_event = 1.0 - sum(EVENT_PROBABILITIES.values())

    print("\n── RTP teórico por nivel de racha (sin eventos) ──")
    print(f"{'Streak':>8} {'Mult':>8} {'RTP normal':>12} {'RTP c/eventos':>15}")
    print("-" * 48)

    for s in range(0, STREAK_CAP + 1, 2):
        mult = streak_multiplier(s)

        # RTP sin eventos
        ev_win  = P_WIN  * HOUSE_EDGE * mult
        ev_lose = P_LOSE * 1.0
        rtp_no_ev = ev_win - ev_lose   # esperanza matemática (negativo = casa gana)

        # RTP con eventos (aproximado, asumiendo eventos distribuidos 50/50 win/lose)
        ev_events = (
            P_WIN * EVENT_PROBABILITIES.get("DOUBLE_WIN", 0)    * 1.60 +
            P_WIN * EVENT_PROBABILITIES.get("TRIPLE_WIN", 0)    * 2.40 +
            P_WIN * EVENT_PROBABILITIES.get("INSTANT_RACHA", 0) * HOUSE_EDGE * (mult + 0.20) -
            P_LOSE * EVENT_PROBABILITIES.get("LOSE_HALF", 0)    * 0.50 -
            P_LOSE * EVENT_PROBABILITIES.get("RESET_RACHA", 0)  * 0.50
        )
        rtp_full = (p_no_event * (ev_win - ev_lose)) + ev_events

        print(f"{s:>8} {mult:>8.2f} {(1+rtp_no_ev)*100:>11.2f}% {(1+rtp_full)*100:>14.2f}%")

    print()


# ─────────────────────────────────────────────
# 10. MAIN — DEMO Y VALIDACIÓN
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  STAKE BOARD — Math SDK v1.0.0")
    print("=" * 60)

    # ── Tabla de RTP por nivel de racha ──
    rtp_by_streak()

    # ── Simulación con racha acumulada (100k rondas, apuesta $1) ──
    print("── Simulación CARRY (racha acumulada, 100k rondas) ──")
    stats_carry = simulate(n_rounds=100_000, bet=1_000_000, streak_policy="carry")
    summary = stats_carry.summary()
    for k, v in summary.items():
        print(f"  {k:<32}: {v}")

    print()

    # ── Simulación sin racha (base, 100k rondas) ──
    print("── Simulación BASE (streak=0 siempre, 100k rondas) ──")
    stats_base = simulate(n_rounds=100_000, bet=1_000_000, streak_policy="reset")
    for k, v in stats_base.summary().items():
        print(f"  {k:<32}: {v}")

    print()

    # ── Ronda de ejemplo ──
    print("── Ejemplo de ronda (apuesta=$10, racha=3) ──")
    example = play_round(bet=10_000_000, streak_before=3)
    print(f"  Resultado   : {example.outcome.value}")
    print(f"  Evento      : {example.event or 'Ninguno'}")
    print(f"  Racha antes : {example.streak_before}")
    print(f"  Racha nueva : {example.new_streak}")
    print(f"  Payout delta: {example.payout_delta / 1_000_000:+.2f} USD")
    print(f"  Sub-rondas  : {example.rps_rounds}")

    print()

    # ── Generar lookup table ──
    generate_lookup_table("lookup_table.json")

    print("\n✅ Todos los cálculos completados.")
