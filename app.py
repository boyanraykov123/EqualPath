"""
app.py — EqualPath Backend
Flask сървър с 3 ендпойнта:
  POST /api/route      ← главния: взима маршрут с AI scoring
  POST /api/obstacles  ← запазва докладвани препятствия (in-memory засега)
  GET  /api/health     ← проверка дали сървърът работи
"""

import os
import sys
import json
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# Fix Windows console encoding for Unicode/Cyrillic output
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from routing import get_candidate_routes
from ai_scorer import score_routes_with_ai
from db import get_db

load_dotenv()

app = Flask(__name__)

# CORS — позволява на frontend-а (localhost файл или друг порт) да вика API-то
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Данните се пазят в Supabase: таблици reports, routes, profiles


# ═══════════════════════════════════════════════════════════════════════════════
# GET /api/health
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/api/health", methods=["GET"])
def health():
    """Проверка дали сървърът и Grok са конфигурирани."""
    ai_ok = bool(
        os.getenv("XAI_API_KEY") and
        os.getenv("XAI_API_KEY") != "your_xai_api_key_here"
    )
    # Проверяваме Supabase връзката
    try:
        db = get_db()
        count = db.table("reports").select("id", count="exact").execute()
        supabase_status = "connected"
        report_count = count.count or 0
    except Exception:
        supabase_status = "disconnected"
        report_count = 0

    return jsonify({
        "status":    "ok",
        "ai":        "configured" if ai_ok else "missing_api_key",
        "supabase":  supabase_status,
        "reports":   report_count,
        "timestamp": datetime.utcnow().isoformat(),
    })


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/route
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/api/route", methods=["POST"])
def route():
    """
    Главен ендпойнт за маршрутиране.

    Очаква JSON body:
    {
        "from": { "lat": 42.697, "lng": 23.321 },
        "to":   { "lat": 42.700, "lng": 23.330 },
        "profile": "wheelchair",          // задължително
        "needs":   ["no-stairs", "quiet"], // по избор
        "notes":   "Използвам проходилка" // по избор
    }

    Връща:
    {
        "ok": true,
        "geojson":        { ... },     // GeoJSON LineString за картата
        "distance_km":    1.23,
        "duration_min":   15.0,
        "comfort_index":  8.4,
        "reason":         "...",       // AI обяснение
        "warning":        "..." | null,
        "route_summary":  "...",
        "alternatives":   [ ... ]      // останалите маршрути (без geojson)
    }
    """

    # ── Валидация на входа ────────────────────────────────────────────────────
    try:
        body = request.get_json(force=True)
    except Exception:
        return jsonify({"ok": False, "error": "Невалиден JSON body."}), 400

    if not body:
        return jsonify({"ok": False, "error": "Липсва JSON body."}), 400

    # from координати
    from_data = body.get("from", {})
    to_data   = body.get("to", {})

    try:
        from_lat = float(from_data["lat"])
        from_lon = float(from_data["lng"])
        to_lat   = float(to_data["lat"])
        to_lon   = float(to_data["lng"])
    except (KeyError, TypeError, ValueError):
        return jsonify({
            "ok": False,
            "error": "Невалидни координати. Трябват from.lat, from.lng, to.lat, to.lng."
        }), 400

    # Проверка за разумни координати
    for lat, lon in [(from_lat, from_lon), (to_lat, to_lon)]:
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return jsonify({"ok": False, "error": f"Координати извън граници: {lat}, {lon}"}), 400

    # Профил и нужди
    profile = body.get("profile", "general")
    valid_profiles = ["wheelchair", "autism", "stroller", "visual", "elderly", "general"]
    if profile not in valid_profiles:
        profile = "general"

    needs = body.get("needs", [])
    if not isinstance(needs, list):
        needs = []

    notes = str(body.get("notes", ""))[:500]  # max 500 символа

    print(f"\n[route] {from_lat},{from_lon} → {to_lat},{to_lon} | profile={profile} | needs={needs}")

    # ── Стъпка 1: Вземи кандидат-маршрути от OSRM + OSM анализ ───────────────
    try:
        print("[route] Стъпка 1: Взимам маршрути от OSRM + OSM анализ...")
        candidates = get_candidate_routes(from_lat, from_lon, to_lat, to_lon, profile, needs)
        print(f"[route] Намерени {len(candidates)} кандидат-маршрути")
    except Exception as e:
        print(f"[route] OSRM/OSM грешка: {e}")
        return jsonify({"ok": False, "error": str(e)}), 502

    # ── Стъпка 2: AI scoring с Grok ────────────────────────────────────────
    try:
        print("[route] Стъпка 2: AI scoring с Grok...")
        result = score_routes_with_ai(candidates, profile, needs, notes)
        print(f"[route] AI избра маршрут {result['chosen_route_index']} | CI={result['comfort_index']}")
    except Exception as e:
        print(f"[route] AI грешка: {e}")
        return jsonify({"ok": False, "error": f"AI scoring грешка: {e}"}), 502

    # ── Стъпка 3: Подготви отговора ───────────────────────────────────────────
    chosen = result["chosen_route"]

    # Алтернативите — с geojson за показване на картата
    alternatives = []
    for c in candidates:
        if c["index"] != chosen["index"]:
            alternatives.append({
                "index":        c["index"],
                "distance_km":  c["distance_km"],
                "duration_min": c["duration_min"],
                "osm_summary":  _osm_summary(c["osm"]),
                "geojson":      c["geojson"],
                "scores":       c.get("scores", {}),
            })

    response = {
        "ok":            True,
        "geojson":       chosen["geojson"],
        "distance_km":   chosen["distance_km"],
        "duration_min":  chosen["duration_min"],
        "comfort_index": result["comfort_index"],
        "reason":        result["reason"],
        "warning":       result["warning"],
        "route_summary": result["route_summary"],
        "osm_data":      chosen["osm"],
        "scores":        chosen.get("scores", {}),
        "profile":       profile,
        "alternatives":  alternatives,
    }

    # ── Запис в Supabase (routes таблица) ───────────────────────────────────
    try:
        db = get_db()
        route_record = {
            "start_location":  str(body.get("from_name", f"{from_lat},{from_lon}"))[:500],
            "end_location":    str(body.get("to_name", f"{to_lat},{to_lon}"))[:500],
            "health_needs":    needs,
            "safety_score":    str(result["comfort_index"]),
            "ai_analysis":     result["reason"],
            "duration_min":    int(chosen["duration_min"]),
            "distance_km":     chosen["distance_km"],
        }
        if body.get("user_id"):
            route_record["user_id"] = body["user_id"]
        db.table("routes").insert(route_record).execute()
    except Exception as e:
        # Не блокираме отговора ако записът се провали
        print(f"[route] Supabase запис грешка (non-fatal): {e}")

    return jsonify(response)


def _osm_summary(osm):
    """Кратко текстово описание на OSM данните за маршрут."""
    parts = []
    if osm.get("stairs_segments", 0) > 0:
        parts.append(f"{osm['stairs_segments']} стълбища")
    if osm.get("cobble_segments", 0) > 0:
        parts.append(f"{osm['cobble_segments']} сегм. с павета")
    if osm.get("bad_kerbs", 0) > 0:
        parts.append(f"{osm['bad_kerbs']} лоши бордюра")
    return ", ".join(parts) if parts else "Чист маршрут"


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/reports  (докладване на препятствие)
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/api/reports", methods=["POST"])
def create_report():
    """
    Приема доклад за препятствие от frontend-а.

    Очаква JSON:
    {
        "type":        "construction",
        "location":    "ул. Витоша 15",
        "description": "...",
        "severity":    "high",
        "latlng":      { "lat": 42.697, "lng": 23.321 },
        "user_id":     "uuid" (по избор),
        "photo_url":   "..." (по избор)
    }
    """
    try:
        body = request.get_json(force=True)
    except Exception:
        return jsonify({"ok": False, "error": "Невалиден JSON."}), 400

    if not body.get("type"):
        return jsonify({"ok": False, "error": "Липсва поле: type"}), 400

    report = {
        "type":        body["type"],
        "location":    str(body.get("location", ""))[:500],
        "description": str(body.get("description", ""))[:1000],
        "severity":    body.get("severity", "medium"),
        "status":      "active",
    }

    # Координати (по избор)
    latlng = body.get("latlng", {})
    if latlng.get("lat") and latlng.get("lng"):
        report["latitude"]  = float(latlng["lat"])
        report["longitude"] = float(latlng["lng"])

    # Потребител (по избор) — проверяваме дали профилът съществува
    if body.get("user_id"):
        try:
            db_check = get_db()
            profile_check = db_check.table("profiles").select("user_id").eq("user_id", body["user_id"]).execute()
            if profile_check.data:
                report["user_id"] = body["user_id"]
            else:
                print(f"[reports] user_id {body['user_id']} not in profiles, skipping")
        except Exception:
            print(f"[reports] Could not verify user_id, skipping")

    # Снимка (по избор)
    if body.get("photo_url"):
        report["photo_url"] = body["photo_url"]

    print(f"[reports] Inserting report: {report}")
    try:
        db = get_db()
        result = db.table("reports").insert(report).execute()
        new_id = result.data[0]["id"]
    except Exception as e:
        print(f"[reports] Supabase error: {e}")
        print(f"[reports] Report data was: {report}")
        return jsonify({"ok": False, "error": f"Grеshka pri zapis: {e}"}), 500

    print(f"[reports] New report {new_id}: {report['type']}")
    return jsonify({"ok": True, "id": new_id})


@app.route("/api/reports", methods=["GET"])
def get_reports():
    """Връща всички активни доклади."""
    try:
        db = get_db()
        result = db.table("reports").select("*").eq("status", "active").order("created_at", desc=True).execute()
    except Exception as e:
        print(f"[reports] Supabase грешка: {e}")
        return jsonify({"ok": False, "error": f"Грешка при четене: {e}"}), 500

    return jsonify({"ok": True, "reports": result.data, "count": len(result.data)})


@app.route("/api/reports/<report_id>", methods=["DELETE"])
def delete_report(report_id):
    """Маркира доклад като resolved (мек изтрий)."""
    try:
        db = get_db()
        db.table("reports").update({"status": "resolved"}).eq("id", report_id).execute()
    except Exception as e:
        print(f"[reports] Supabase грешка: {e}")
        return jsonify({"ok": False, "error": f"Грешка: {e}"}), 500

    print(f"[reports] Доклад {report_id} маркиран като resolved")
    return jsonify({"ok": True})


# ═══════════════════════════════════════════════════════════════════════════════
# GET /api/routes/:user_id  (история на маршрутите)
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/api/routes/<user_id>", methods=["GET"])
def get_user_routes(user_id):
    """Връща историята на маршрутите за даден потребител."""
    try:
        db = get_db()
        result = db.table("routes").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
    except Exception as e:
        return jsonify({"ok": False, "error": f"Грешка: {e}"}), 500

    return jsonify({"ok": True, "routes": result.data, "count": len(result.data)})


# ═══════════════════════════════════════════════════════════════════════════════
# /api/profiles  (потребителски профили)
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/api/profiles", methods=["POST"])
def create_profile():
    """Създава или обновява потребителски профил."""
    try:
        body = request.get_json(force=True)
    except Exception:
        return jsonify({"ok": False, "error": "Невалиден JSON."}), 400

    if not body.get("user_id"):
        return jsonify({"ok": False, "error": "Липсва user_id."}), 400

    profile = {
        "user_id":      body["user_id"],
        "full_name":    str(body.get("full_name", ""))[:200],
        "health_needs": body.get("health_needs", []),
    }

    try:
        db = get_db()
        result = db.table("profiles").upsert(profile, on_conflict="user_id").execute()
    except Exception as e:
        return jsonify({"ok": False, "error": f"Грешка: {e}"}), 500

    return jsonify({"ok": True, "profile": result.data[0]})


@app.route("/api/profiles/<user_id>", methods=["GET"])
def get_profile(user_id):
    """Връща профила на потребител."""
    try:
        db = get_db()
        result = db.table("profiles").select("*").eq("user_id", user_id).single().execute()
    except Exception as e:
        return jsonify({"ok": False, "error": f"Профилът не е намерен."}), 404

    return jsonify({"ok": True, "profile": result.data})


# ═══════════════════════════════════════════════════════════════════════════════
# POST /api/chat  (AI асистент)
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/api/chat", methods=["POST"])
def chat():
    """AI чат асистент за достъпна навигация."""
    try:
        body = request.get_json(force=True)
    except Exception:
        return jsonify({"ok": False, "error": "Невалиден JSON."}), 400

    message = str(body.get("message", ""))[:1000]
    if not message:
        return jsonify({"ok": False, "error": "Липсва съобщение."}), 400

    try:
        from openai import OpenAI
        client = OpenAI(
            api_key=os.getenv("XAI_API_KEY", ""),
            base_url="https://api.x.ai/v1",
        )

        system_prompt = """Ти си AI асистент на EqualPath — приложение за достъпна градска навигация за хора с увреждания, детски колички, възрастни хора и др.

Отговаряй кратко и полезно на български. Можеш да помагаш с:
- Информация за достъпни маршрути
- Съвети за навигация с инвалидна количка, детска количка и др.
- Обяснения как работи приложението
- Информация за препятствия и как да ги докладваш
- Общи въпроси за достъпност в градска среда"""

        response = client.chat.completions.create(
            model="grok-3-mini",
            max_tokens=1024,
            temperature=0.7,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message},
            ],
        )
        reply = response.choices[0].message.content.strip()
    except Exception as e:
        print(f"[chat] AI грешка: {e}")
        reply = "Извинявам се, в момента не мога да отговоря. Моля, опитай отново по-късно."

    return jsonify({"ok": True, "reply": reply})


# ═══════════════════════════════════════════════════════════════════════════════
# Error handlers
# ═══════════════════════════════════════════════════════════════════════════════

@app.errorhandler(404)
def not_found(e):
    return jsonify({"ok": False, "error": "Ендпойнтът не съществува."}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"ok": False, "error": "Невалиден HTTP метод."}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"ok": False, "error": "Вътрешна сървърна грешка."}), 500


# ═══════════════════════════════════════════════════════════════════════════════
# Run
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 5000))
    print(f"\n  EqualPath Backend v1.0")
    print(f"  http://localhost:{port}\n")
    print(f"  POST /api/route         <- route")
    print(f"  POST /api/reports       <- report")
    print(f"  GET  /api/reports       <- get reports")
    print(f"  GET  /api/routes/:uid   <- history")
    print(f"  POST /api/profiles      <- profile")
    print(f"  GET  /api/profiles/:uid <- get profile")
    print(f"  GET  /api/health        <- status\n")
    app.run(
        host="0.0.0.0",
        port=port,
        debug=os.getenv("FLASK_ENV") == "development",
    )
