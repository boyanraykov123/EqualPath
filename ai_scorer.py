"""
ai_scorer.py — EqualPath
Gemini AI scorer: взима анализирани маршрути + потребителски профил
и избира най-удобния маршрут с обяснение.
"""

import os
import json
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

# ── Gemini setup ──────────────────────────────────────────────────────────────
_gemini_configured = False

def _ensure_configured():
    global _gemini_configured
    if _gemini_configured:
        return
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key or api_key == "your_gemini_api_key_here":
        raise Exception(
            "GEMINI_API_KEY не е зададен. "
            "Копирай .env.example → .env и добави ключа от "
            "https://aistudio.google.com/app/apikey"
        )
    genai.configure(api_key=api_key)
    _gemini_configured = True


# ── Profile definitions ───────────────────────────────────────────────────────
PROFILE_DESCRIPTIONS = {
    "wheelchair": (
        "Потребителят е на инвалидна количка. "
        "КРИТИЧНО: стълби са абсолютно непреодолими, павета и лоши бордюри са много проблематични. "
        "Нужни са рампи, гладки настилки и широки пешеходни зони (мин. 1.2м)."
    ),
    "autism": (
        "Потребителят има аутизъм или сензорна свръхчувствителност. "
        "Приоритет: тихи улици с малко хора и трафик, познати и предсказуеми пътеки. "
        "Стълбите и бордюрите са по-малко проблем от претъпкани улици."
    ),
    "stroller": (
        "Потребителят управлява детска количка. "
        "ВАЖНО: стълбите са непреодолими, павета са много неудобни, нужни са гладки настилки. "
        "Бордюри без рампи са проблематични."
    ),
    "visual": (
        "Потребителят има зрителни затруднения. "
        "Приоритет: широки, добре осветени пешеходни зони с ясна настилка. "
        "Неосветени участъци и лоши бордюри са опасни."
    ),
    "elderly": (
        "Потребителят е възрастен с бавна походка или затруднения при ходене. "
        "Приоритет: по-кратък маршрут, наличие на пейки за почивка, избягване на стръмни участъци. "
        "Стълбите са трудни но не винаги непреодолими."
    ),
    "general": (
        "Стандартен пешеходен маршрут. "
        "Балансирай между удобство и разстояние."
    ),
}

NEED_DESCRIPTIONS = {
    "no-stairs":  "Абсолютно без стълби",
    "no-cobble":  "Без павета и неравна настилка",
    "quiet":      "Тихи улици с малко трафик и хора",
    "no-crowds":  "Избягвай претъпкани места",
    "shade":      "Предпочитай сенчести маршрути",
    "benches":    "Важно: наличие на пейки за почивка по пътя",
    "lighting":   "Добро осветление (важно за сигурност)",
    "toilets":    "Близки достъпни тоалетни",
    "smooth":     "Гладка настилка",
    "wide":       "Широки тротоари (мин. 1.5м)",
}


# ── Prompt builder ────────────────────────────────────────────────────────────

def build_prompt(routes, profile, needs, notes=""):
    """Изгражда структуриран prompt за Gemini."""

    profile_desc = PROFILE_DESCRIPTIONS.get(profile, PROFILE_DESCRIPTIONS["general"])
    needs_list   = "\n".join(f"  - {NEED_DESCRIPTIONS.get(n, n)}" for n in needs) if needs else "  (няма специфични)"
    notes_part   = f"\nДопълнителна информация от потребителя: {notes}" if notes else ""

    routes_text = ""
    for r in routes:
        osm = r["osm"]
        sc  = r["scores"]
        obs_text = ""
        if r.get("obstacles_nearby"):
            obs_text = "\n  ДОКЛАДВАНИ ПРЕПЯТСТВИЯ по този маршрут:\n"
            for ob in r["obstacles_nearby"]:
                obs_text += f"    ⚠️ {ob['type']} ({ob['severity']}) на {ob['distance_m']}м от маршрута"
                if ob.get("description"):
                    obs_text += f" — {ob['description']}"
                obs_text += "\n"
        routes_text += f"""
--- Маршрут {r['index'] + 1} ---
Разстояние: {r['distance_km']} км | Времетраене: {r['duration_min']} мин
OSM характеристики:
  - Сегменти със стълби: {osm['stairs_segments']}
  - Сегменти с павета/лоша настилка: {osm['cobble_segments']}
  - Бордюри без рампи: {osm['bad_kerbs']}
  - Стръмни участъци (>8%): {osm['steep_segments']}
  - Неосветени участъци: {osm['unlit_segments']}
  - Пешеходни зони: {osm['footway_segments']}
  - Пейки наблизо: {osm['benches_nearby']}
  - Достъпни тоалетни наблизо: {osm['accessible_toilets_nearby']}
  - Докладвани препятствия: {osm.get('reported_obstacles', 0)}
Нормализирани оценки (0=лошо, 1=добро):
  stairs={sc['stairs']} | cobble={sc['cobble']} | kerbs={sc['kerbs']} | steep={sc['steep']} | lighting={sc['lighting']} | obstacles={sc.get('obstacles', 1.0)}
{obs_text}"""

    prompt = f"""Ти си AI асистент за достъпна градска навигация.

ПРОФИЛ НА ПОТРЕБИТЕЛЯ:
{profile_desc}

СПЕЦИФИЧНИ НУЖДИ:
{needs_list}{notes_part}

КАНДИДАТ-МАРШРУТИ (данни от OpenStreetMap):
{routes_text}

ЗАДАЧА:
1. Анализирай всеки маршрут спрямо нуждите на потребителя
2. КРИТИЧНО: Ако маршрут има докладвани препятствия, ИЗБЯГВАЙ го! Препятствията са реални доклади от потребители.
3. Избери НАЙ-УДОБНИЯ маршрут (не задължително най-краткия)
4. Изчисли Comfort Index от 1 до 10 за избрания маршрут (маршрути с препятствия трябва да имат значително по-нисък CI)
5. Обясни накратко защо си избрал точно него (2-3 изречения на български)
6. Посочи основния недостатък на маршрута (ако има)

ОТГОВОРИ САМО С ВАЛИДЕН JSON (без markdown, без обяснения извън JSON):
{{
  "chosen_route_index": <0-based индекс>,
  "comfort_index": <1.0-10.0>,
  "reason": "<защо е най-удобен, 2-3 изречения на български>",
  "warning": "<основен недостатък или null ако няма>",
  "route_summary": "<едно изречение описание на маршрута>"
}}"""

    return prompt


# ── Gemini call ───────────────────────────────────────────────────────────────

def score_routes_with_ai(routes, profile, needs, notes=""):
    """
    Главна функция: изпраща маршрутите към Gemini и връща решението.

    Връща речник:
    {
        "chosen_route_index": int,
        "comfort_index": float,
        "reason": str,
        "warning": str | None,
        "route_summary": str,
        "chosen_route": <пълните данни за маршрута>
    }
    """
    _ensure_configured()

    if not routes:
        raise Exception("Няма маршрути за оценяване.")

    # Ако има само един маршрут, пропускаме AI и връщаме директно
    if len(routes) == 1:
        r = routes[0]
        ci = _calculate_fallback_ci(r, profile, needs)
        return {
            "chosen_route_index": 0,
            "comfort_index": ci,
            "reason": "Намерен е само един маршрут.",
            "warning": None,
            "route_summary": f"{r['distance_km']} км, {r['duration_min']} мин",
            "chosen_route": r,
        }

    prompt = build_prompt(routes, profile, needs, notes)

    try:
        model    = genai.GenerativeModel("gemini-2.5-flash")  # безплатен модел
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.4,
                max_output_tokens=8192,
                response_mime_type="application/json",
            ),
        )
        raw_text = response.text.strip()
    except Exception as e:
        print(f"[ai_scorer] Gemini грешка: {e}")
        # Fallback: избираме маршрута с най-добър score без AI
        return _fallback_score(routes, profile, needs)

    # ── Парсване на JSON отговора ─────────────────────────────────────────────
    try:
        # Gemini понякога добавя ```json ... ``` — почистваме
        clean = raw_text
        if "```" in clean:
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
            clean = clean.split("```")[0]
        clean = clean.strip()

        result = json.loads(clean)

        idx = int(result.get("chosen_route_index", 0))
        idx = max(0, min(idx, len(routes) - 1))  # stay in bounds

        return {
            "chosen_route_index": idx,
            "comfort_index":      float(result.get("comfort_index", 5.0)),
            "reason":             result.get("reason", ""),
            "warning":            result.get("warning") or None,
            "route_summary":      result.get("route_summary", ""),
            "chosen_route":       routes[idx],
        }

    except (json.JSONDecodeError, KeyError, ValueError) as e:
        print(f"[ai_scorer] JSON parse грешка: {e}\nRaw: {raw_text[:300]}")
        return _fallback_score(routes, profile, needs)


# ── Fallback (без AI) ─────────────────────────────────────────────────────────

# Тежести на всеки профил за fallback scoring
PROFILE_WEIGHTS = {
    "wheelchair": {"stairs": 5.0, "cobble": 3.0, "kerbs": 2.5, "steep": 2.0, "lighting": 0.5, "footways": 1.0, "obstacles": 5.0},
    "autism":     {"stairs": 1.0, "cobble": 1.0, "kerbs": 0.5, "steep": 0.5, "lighting": 1.5, "footways": 2.0, "obstacles": 4.0},
    "stroller":   {"stairs": 4.5, "cobble": 3.0, "kerbs": 2.0, "steep": 1.5, "lighting": 0.5, "footways": 1.0, "obstacles": 5.0},
    "visual":     {"stairs": 2.0, "cobble": 1.5, "kerbs": 2.0, "steep": 1.0, "lighting": 4.0, "footways": 2.0, "obstacles": 4.0},
    "elderly":    {"stairs": 3.0, "cobble": 2.0, "kerbs": 1.5, "steep": 3.0, "lighting": 1.0, "footways": 1.5, "obstacles": 4.0},
    "general":    {"stairs": 1.0, "cobble": 1.0, "kerbs": 1.0, "steep": 1.0, "lighting": 1.0, "footways": 1.0, "obstacles": 3.0},
}


def _calculate_fallback_ci(route, profile, needs):
    """Изчислява Comfort Index без AI, само по тежести."""
    weights = PROFILE_WEIGHTS.get(profile, PROFILE_WEIGHTS["general"])
    scores  = route.get("scores", {})

    total_weight = sum(weights.values())
    weighted_sum = sum(
        weights.get(key, 1.0) * scores.get(key, 0.5)
        for key in weights
    )
    # Нормализираме към 1-10
    ci = 1 + 9 * (weighted_sum / total_weight)
    return round(min(10.0, max(1.0, ci)), 1)


def _fallback_score(routes, profile, needs):
    """Fallback при Gemini грешка: избира най-добрия маршрут по тежести."""
    scored = []
    for r in routes:
        ci = _calculate_fallback_ci(r, profile, needs)
        scored.append((ci, r))

    scored.sort(key=lambda x: x[0], reverse=True)
    best_ci, best_route = scored[0]

    return {
        "chosen_route_index": best_route["index"],
        "comfort_index":      best_ci,
        "reason":             "Маршрутът е избран автоматично по Comfort Index (AI недостъпен).",
        "warning":            "AI scorer е временно недостъпен.",
        "route_summary":      f"{best_route['distance_km']} км, {best_route['duration_min']} мин",
        "chosen_route":       best_route,
    }
