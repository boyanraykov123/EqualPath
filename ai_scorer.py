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
{f"  ⚠ ПРОФИЛ-НАКАЗАНИЕ: {r['profile_penalty']} (маршрутът нарушава критични изисквания за този профил — ИЗБЯГВАЙ!)" if r.get('profile_penalty', 0) > 0 else ""}{obs_text}"""

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
    Главна функция: избира най-удобния маршрут чрез локално претеглено оценяване.
    Използва профил-специфични тежести и OSM метрики (без AI API извикване).

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

    if len(routes) == 1:
        r = routes[0]
        ci = _calculate_fallback_ci(r, profile, needs)
        return _ensure_obstacle_avoidance({
            "chosen_route_index": r["index"],
            "comfort_index": ci,
            "reason": _build_reason(r, profile),
            "warning": _build_warning(r, profile),
            "route_summary": f"{r['distance_km']} км, {r['duration_min']} мин",
            "chosen_route": r,
        }, routes, profile, needs)

    # Оценяваме всички маршрути по профил-специфичните тежести
    scored = []
    for r in routes:
        ci = _calculate_fallback_ci(r, profile, needs)
        scored.append((ci, r))

    scored.sort(key=lambda x: x[0], reverse=True)
    best_ci, best_route = scored[0]

    print(f"[scorer] Класиране за профил '{profile}':")
    for ci, r in scored:
        pen = r.get("profile_penalty", 0)
        pen_str = f" [penalty={pen}]" if pen > 0 else ""
        print(f"[scorer]   Маршрут {r['index']}: CI={ci}{pen_str}")

    result = {
        "chosen_route_index": best_route["index"],
        "comfort_index":      best_ci,
        "reason":             _build_reason(best_route, profile),
        "warning":            _build_warning(best_route, profile),
        "route_summary":      f"{best_route['distance_km']} км, {best_route['duration_min']} мин",
        "chosen_route":       best_route,
    }
    return _ensure_obstacle_avoidance(result, routes, profile, needs)


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
    """Изчислява Comfort Index по профил-специфични тежести + hard penalty."""
    weights = PROFILE_WEIGHTS.get(profile, PROFILE_WEIGHTS["general"])
    scores  = route.get("scores", {})
    osm     = route.get("osm", {})

    total_weight = sum(weights.values())
    weighted_sum = sum(
        weights.get(key, 1.0) * scores.get(key, 0.5)
        for key in weights
    )
    ci = 1 + 9 * (weighted_sum / total_weight)

    # Hard penalties: критични нарушения драстично намаляват CI
    if profile in ("wheelchair", "stroller"):
        stairs = osm.get("stairs_segments", 0)
        if stairs > 0:
            ci -= stairs * 3.0  # всяко стълбище сваля с 3 точки
        cobble = osm.get("cobble_segments", 0)
        if cobble > 1:
            ci -= (cobble - 1) * 1.0
    elif profile == "autism":
        busy = osm.get("busy_roads_nearby", 0)
        if busy > 2:
            ci -= (busy - 2) * 1.5
        turns = osm.get("significant_turns", 0)
        if turns > 6:
            ci -= (turns - 6) * 0.5
        # Бонус за зелени площи
        parks = osm.get("parks_nearby", 0)
        if parks > 0:
            ci += min(parks * 0.8, 2.5)
    elif profile == "visual":
        unlit = osm.get("unlit_segments", 0)
        if unlit > 1:
            ci -= (unlit - 1) * 1.5
    elif profile == "elderly":
        steep = osm.get("steep_segments", 0)
        if steep > 0:
            ci -= steep * 1.5
        benches = osm.get("benches_nearby", 0)
        if benches > 0:
            ci += min(benches * 0.4, 1.5)

    # Profile penalty от routing.py
    penalty = route.get("profile_penalty", 0)
    if penalty > 0:
        ci -= penalty * 2.0

    # Бонус за маршрути генерирани специално за този профил (Overpass waypoints)
    source = route.get("source", "")
    if source == f"profile-{profile}":
        ci += 1.5

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


_PROFILE_REASON_LABELS = {
    "wheelchair": "инвалидна количка",
    "autism":     "аутизъм/сензорно",
    "stroller":   "детска количка",
    "visual":     "зрителни затруднения",
    "elderly":    "възрастен",
    "general":    "пешеходен",
}

def _build_reason(route, profile):
    """Генерира обяснение за избора на маршрут на базата на OSM данни."""
    osm = route.get("osm", {})
    scores = route.get("scores", {})
    parts = []
    label = _PROFILE_REASON_LABELS.get(profile, "пешеходен")

    # Позитивни характеристики
    if scores.get("stairs", 0.5) >= 0.9 and profile in ("wheelchair", "stroller"):
        parts.append("без стълби")
    if scores.get("smooth", 0) >= 0.5:
        parts.append("гладка настилка")
    if scores.get("green", 0) >= 0.4 and profile in ("autism", "elderly"):
        parts.append("зелени площи по маршрута")
    if scores.get("noise", 0.5) >= 0.7 and profile == "autism":
        parts.append("тих маршрут")
    if scores.get("lighting", 0.5) >= 0.7 and profile == "visual":
        parts.append("добро осветление")
    if scores.get("tactile", 0) >= 0.3 and profile == "visual":
        parts.append("тактилна настилка")
    if scores.get("benches", 0) >= 0.3 and profile == "elderly":
        parts.append("пейки за почивка")
    if osm.get("footway_segments", 0) >= 3:
        parts.append("пешеходни зони")

    if parts:
        return f"Маршрут за {label}: {', '.join(parts)}."
    return f"Най-удобният маршрут за профил {label}."


def _build_warning(route, profile):
    """Генерира предупреждение ако маршрутът има проблеми за профила."""
    osm = route.get("osm", {})
    warnings = []

    if profile in ("wheelchair", "stroller") and osm.get("stairs_segments", 0) > 0:
        warnings.append(f"{osm['stairs_segments']} стълбищни сегмента")
    if profile in ("wheelchair", "stroller") and osm.get("cobble_segments", 0) > 2:
        warnings.append("неравна настилка")
    if profile == "autism" and osm.get("busy_roads_nearby", 0) > 3:
        warnings.append("натоварени улици наблизо")
    if profile == "visual" and osm.get("unlit_segments", 0) > 1:
        warnings.append("неосветени участъци")
    if profile == "elderly" and osm.get("steep_segments", 0) > 1:
        warnings.append("стръмни участъци")
    if osm.get("reported_obstacles", 0) > 0:
        warnings.append(f"{osm['reported_obstacles']} докладвани препятствия")

    if warnings:
        return "Внимание: " + ", ".join(warnings) + "."
    return None


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
