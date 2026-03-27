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

# ── Gemini setup ─────────────────────────────────────────────────────────────
_model = None

def _ensure_configured():
    global _model
    if _model is not None:
        return
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key or api_key == "your_gemini_api_key_here":
        raise Exception(
            "GEMINI_API_KEY не е зададен. "
            "Копирай .env.example → .env и добави ключа от "
            "https://aistudio.google.com/app/apikey"
        )
    genai.configure(api_key=api_key)
    _model = genai.GenerativeModel("gemini-2.0-flash")


# ── Profile definitions ───────────────────────────────────────────────────────
PROFILE_DESCRIPTIONS = {
    "wheelchair": (
        "Потребителят е на инвалидна количка. "
        "КРИТИЧНО: стълби са абсолютно непреодолими, павета и лоши бордюри са много проблематични. "
        "Нужни са рампи, ГЛАДКИ настилки (асфалт, бетон) и широки пешеходни зони (мин. 1.2м). "
        "Предпочитай маршрути с висок smooth score."
    ),
    "autism": (
        "Потребителят има аутизъм или сензорна свръхчувствителност. "
        "КРИТИЧНО: избягвай натоварени/шумни улици (busy_roads_nearby), претъпкани зони и сложни маршрути с много завои (significant_turns). "
        "Приоритет: тихи, предсказуеми пътеки с малко промени на посоката. "
        "Зелени площи (паркове, градини) по маршрута са СИЛНО ПРЕДПОЧИТАНИ за сензорно успокоение. "
        "Стълбите и бордюрите са по-малко проблем от шума, тълпите и непредсказуемостта."
    ),
    "stroller": (
        "Потребителят управлява детска количка. "
        "ВАЖНО: стълбите са непреодолими, павета са много неудобни, нужни са ГЛАДКИ настилки (асфалт, бетон). "
        "Бордюри без рампи са проблематични. Предпочитай маршрути с повече smooth_surface сегменти."
    ),
    "visual": (
        "Потребителят има зрителни затруднения. "
        "КРИТИЧНО: тактилна настилка (tactile_paving) е ИЗКЛЮЧИТЕЛНО ВАЖНА за ориентация. "
        "Приоритет: добре осветени пешеходни зони, кръстовища със светофар (safe_crossings), прости маршрути с малко завои. "
        "Неосветени участъци и лоши бордюри са ОПАСНИ. Гладка настилка помага за ориентация."
    ),
    "elderly": (
        "Потребителят е възрастен с бавна походка или затруднения при ходене. "
        "Приоритет: по-кратък маршрут, наличие на пейки за почивка, избягване на стръмни участъци. "
        "Зелени площи и безопасни кръстовища със светофар са предпочитани. "
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
  - Натоварени улици наблизо: {osm.get('busy_roads_nearby', 0)}
  - Паркове/градини наблизо: {osm.get('parks_nearby', 0)}
  - Тактилна настилка: {osm.get('tactile_paving', 0)}
  - Кръстовища със светофар: {osm.get('safe_crossings', 0)}
  - Гладка настилка (асфалт/бетон): {osm.get('smooth_surface', 0)}
  - Значими завои: {osm.get('significant_turns', 0)}
  - Докладвани препятствия: {osm.get('reported_obstacles', 0)}
Нормализирани оценки (0=лошо, 1=добро):
  stairs={sc['stairs']} | cobble={sc['cobble']} | kerbs={sc['kerbs']} | steep={sc['steep']} | lighting={sc['lighting']} | obstacles={sc.get('obstacles', 1.0)}
  noise={sc.get('noise', 0.5)} | complexity={sc.get('complexity', 0.5)} | green={sc.get('green', 0.0)} | crossings={sc.get('crossings', 0.0)} | smooth={sc.get('smooth', 0.0)} | tactile={sc.get('tactile', 0.0)}
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
        _ensure_configured()
        response = _model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                max_output_tokens=4096,
                temperature=0.4,
            ),
        )
        raw_text = response.text.strip()
    except Exception as e:
        print(f"[ai_scorer] Gemini error: {e}")
        # Fallback: избираме маршрута с най-добър score без AI
        fallback = _fallback_score(routes, profile, needs)
        return _ensure_obstacle_avoidance(fallback, routes, profile, needs)

    # ── Парсване на JSON отговора ─────────────────────────────────────────────
    try:
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

        ai_result = {
            "chosen_route_index": idx,
            "comfort_index":      float(result.get("comfort_index", 5.0)),
            "reason":             result.get("reason", ""),
            "warning":            result.get("warning") or None,
            "route_summary":      result.get("route_summary", ""),
            "chosen_route":       routes[idx],
        }
        return _ensure_obstacle_avoidance(ai_result, routes, profile, needs)

    except (json.JSONDecodeError, KeyError, ValueError) as e:
        print(f"[ai_scorer] JSON parse грешка: {e}\nRaw: {raw_text[:300]}")
        fallback = _fallback_score(routes, profile, needs)
        return _ensure_obstacle_avoidance(fallback, routes, profile, needs)


# ── Fallback (без AI) ─────────────────────────────────────────────────────────

# Тежести на всеки профил за fallback scoring
PROFILE_WEIGHTS = {
    "wheelchair": {"stairs": 5.0, "cobble": 3.0, "kerbs": 2.5, "steep": 2.0, "lighting": 0.5, "footways": 1.0, "obstacles": 5.0,
                   "noise": 0.2, "complexity": 0.2, "green": 0.3, "crossings": 0.5, "smooth": 3.0, "tactile": 0.2},
    "autism":     {"stairs": 1.0, "cobble": 1.0, "kerbs": 0.5, "steep": 0.5, "lighting": 1.5, "footways": 2.0, "obstacles": 4.0,
                   "noise": 5.0, "complexity": 4.0, "green": 3.5, "crossings": 1.0, "smooth": 0.5, "tactile": 0.2},
    "stroller":   {"stairs": 4.5, "cobble": 3.0, "kerbs": 2.0, "steep": 1.5, "lighting": 0.5, "footways": 1.0, "obstacles": 5.0,
                   "noise": 0.5, "complexity": 0.3, "green": 0.5, "crossings": 1.0, "smooth": 3.0, "tactile": 0.2},
    "visual":     {"stairs": 2.0, "cobble": 1.5, "kerbs": 2.0, "steep": 1.0, "lighting": 4.0, "footways": 2.0, "obstacles": 4.0,
                   "noise": 1.0, "complexity": 1.5, "green": 0.5, "crossings": 3.5, "smooth": 1.0, "tactile": 4.0},
    "elderly":    {"stairs": 3.0, "cobble": 2.0, "kerbs": 1.5, "steep": 3.0, "lighting": 1.0, "footways": 1.5, "obstacles": 4.0,
                   "noise": 1.0, "complexity": 1.5, "green": 2.0, "crossings": 2.0, "smooth": 1.5, "tactile": 0.3},
    "general":    {"stairs": 1.0, "cobble": 1.0, "kerbs": 1.0, "steep": 1.0, "lighting": 1.0, "footways": 1.0, "obstacles": 3.0,
                   "noise": 0.5, "complexity": 0.5, "green": 0.5, "crossings": 0.5, "smooth": 0.5, "tactile": 0.2},
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


def _ensure_obstacle_avoidance(result, routes, profile, needs):
    """
    Хард override: ако избраният маршрут минава през препятствия,
    но има чиста алтернатива — принудително избира чистата.
    """
    chosen = result["chosen_route"]
    chosen_obs = chosen.get("osm", {}).get("reported_obstacles", 0)
    if chosen_obs == 0:
        return result  # Вече е чист маршрут

    # Търсим маршрут без препятствия
    clean = [r for r in routes if r.get("osm", {}).get("reported_obstacles", 0) == 0]
    if not clean:
        # Няма чист маршрут — поне избираме с най-малко препятствия
        least = min(routes, key=lambda r: r.get("osm", {}).get("reported_obstacles", 0))
        least_obs = least.get("osm", {}).get("reported_obstacles", 0)
        if least_obs < chosen_obs and least["index"] != chosen["index"]:
            print(f"[ai_scorer] Override: маршрут {chosen['index']}→{least['index']} (от {chosen_obs} на {least_obs} препятствия)")
            result["chosen_route_index"] = least["index"]
            result["chosen_route"] = least
            result["comfort_index"] = _calculate_fallback_ci(least, profile, needs)
            result["reason"] = f"Пренасочено за да намали препятствията ({least_obs} вместо {chosen_obs}). " + result.get("reason", "")
            result["warning"] = f"Маршрутът все още минава през {least_obs} препятстви{'е' if least_obs == 1 else 'я'}. Бъдете внимателни."
        return result

    # Има чист маршрут — избираме го
    best = max(clean, key=lambda r: _calculate_fallback_ci(r, profile, needs))
    print(f"[ai_scorer] Override: маршрут {chosen['index']}→{best['index']} (избягва {chosen_obs} препятстви{'е' if chosen_obs == 1 else 'я'})")
    result["chosen_route_index"] = best["index"]
    result["chosen_route"] = best
    result["comfort_index"] = _calculate_fallback_ci(best, profile, needs)
    result["reason"] = f"Пренасочено за да избегне {chosen_obs} докладвани препятстви{'е' if chosen_obs == 1 else 'я'}. " + result.get("reason", "")
    result["warning"] = "Маршрутът е по-дълъг, но заобикаля докладваните препятствия."
    return result


def _fallback_score(routes, profile, needs):
    """Fallback при Gemini грешка: избира най-добрия маршрут по тежести."""
    # За 'general' профил — просто най-бързият маршрут
    if profile == "general":
        best_route = min(routes, key=lambda r: r.get("duration_s", r.get("duration_min", 999) * 60))
        return {
            "chosen_route_index": best_route["index"],
            "comfort_index":      round(best_route.get("duration_min", 0), 1),
            "reason":             "Най-бързият маршрут.",
            "warning":            None,
            "route_summary":      f"{best_route['distance_km']} км, {best_route['duration_min']} мин",
            "chosen_route":       best_route,
        }

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
