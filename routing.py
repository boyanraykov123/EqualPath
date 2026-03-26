"""
routing.py — EqualPath
Отговаря за:
  1. Вземане на кандидат-маршрути от OSRM (пешеходен профил)
  2. Анализ на всеки маршрут чрез OSM Overpass API
     → брои стълби, павета, тесни пасажи, пешеходни зони и др.
  3. Връща структурирани данни за AI scorer-а
"""

import requests
import math
from db import get_db

# ── External API endpoints ────────────────────────────────────────────────────
OSRM_BASE     = "https://routing.openstreetmap.de/routed-foot/route/v1/foot"
OVERPASS_BASE = "https://overpass-api.de/api/interpreter"

# Nominatim за reverse geocoding (ако се наложи)
NOMINATIM_BASE = "https://nominatim.openstreetmap.org"

HEADERS = {"User-Agent": "EqualPath/1.0 (accessibility navigation app)"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def haversine(lat1, lon1, lat2, lon2):
    """Разстояние в метри между две точки (Haversine формула)."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bbox_from_coords(coords, padding=0.002):
    """
    Изчислява bounding box около списък от координати.
    coords: [(lon, lat), ...]
    padding: степени на разширяване (default ~200м)
    """
    lats = [c[1] for c in coords]
    lons = [c[0] for c in coords]
    return {
        "south": min(lats) - padding,
        "north": max(lats) + padding,
        "west":  min(lons) - padding,
        "east":  max(lons) + padding,
    }


def sample_coords(coords, max_points=40):
    """
    Вземa равномерна извадка от координати за Overpass заявката.
    Overpass има лимит — не изпращаме 500 точки.
    """
    if len(coords) <= max_points:
        return coords
    step = len(coords) / max_points
    return [coords[int(i * step)] for i in range(max_points)]


# ── Step 1: OSRM Routing ──────────────────────────────────────────────────────

def get_osrm_routes(from_lat, from_lon, to_lat, to_lon, alternatives=3):
    """
    Взима до `alternatives` маршрута от OSRM.
    Връща списък от route обекти или хвърля Exception.

    OSRM coordinate format: lon,lat (не lat,lon!)
    """
    coords = f"{from_lon},{from_lat};{to_lon},{to_lat}"
    url = (
        f"{OSRM_BASE}/{coords}"
        f"?overview=full"
        f"&geometries=geojson"
        f"&alternatives={alternatives}"
        f"&steps=true"
        f"&annotations=false"
    )

    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
    except requests.exceptions.Timeout:
        raise Exception("OSRM timeout — маршрутният сървър не отговори.")
    except requests.exceptions.RequestException as e:
        raise Exception(f"OSRM мрежова грешка: {e}")

    data = resp.json()

    if data.get("code") != "Ok":
        raise Exception(f"OSRM грешка: {data.get('code')} — {data.get('message', '')}")

    if not data.get("routes"):
        raise Exception("OSRM не намери маршрут между тези точки.")

    routes = []
    for i, r in enumerate(data["routes"]):
        geom = r["geometry"]  # GeoJSON LineString
        coords_list = geom["coordinates"]  # [[lon, lat], ...]

        routes.append({
            "index":    i,
            "geojson":  geom,
            "coords":   coords_list,       # [[lon, lat], ...]
            "distance": r["distance"],     # метри
            "duration": r["duration"],     # секунди
            "legs":     r.get("legs", []),
        })

    return routes


# ── Step 2: OSM Overpass Analysis ─────────────────────────────────────────────

def build_overpass_query(bbox):
    """
    Изгражда Overpass QL заявка, която търси:
    - Стълби (highway=steps)
    - Павета (surface=cobblestone / sett / unpaved)
    - Тесни пасажи (width < 1.2m)
    - Пешеходни зони (highway=pedestrian / footway / path)
    - Кръстовища без рампи (kerb=* без kerb=lowered/flush)
    - Наклонени участъци (incline > 8%)
    """
    s, n, w, e = bbox["south"], bbox["north"], bbox["west"], bbox["east"]
    bb = f"{s},{w},{n},{e}"

    return f"""
[out:json][timeout:25];
(
  way["highway"="steps"]({bb});
  way["surface"="cobblestone"]({bb});
  way["surface"="sett"]({bb});
  way["surface"="unpaved"]({bb});
  way["surface"="gravel"]({bb});
  way["surface"="dirt"]({bb});
  way["highway"~"^(footway|path|pedestrian)$"]["width"~"^[0-9]"]["width"<"1.2"]({bb});
  node["kerb"]["kerb"!="lowered"]["kerb"!="flush"]["kerb"!="yes"]({bb});
  way["incline"~"^[89][0-9]*%$"]({bb});
  way["incline"~"^[1-9][0-9]+%$"]({bb});
  way["lit"="no"]["highway"~"^(footway|path|pedestrian|sidewalk)$"]({bb});
  way["highway"~"^(footway|path|pedestrian)$"]({bb});
  way["highway"="cycleway"]["foot"="yes"]({bb});
  node["amenity"="bench"]({bb});
  node["amenity"="toilets"]["wheelchair"!="no"]({bb});
);
out body;
""".strip()


def query_overpass(bbox):
    """Изпраща заявка към Overpass и връща raw JSON."""
    query = build_overpass_query(bbox)
    try:
        resp = requests.post(
            OVERPASS_BASE,
            data={"data": query},
            headers=HEADERS,
            timeout=20,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.Timeout:
        # Overpass timeout не е фатален — просто нямаме OSM данни
        return {"elements": []}
    except Exception:
        return {"elements": []}


def count_near_route(elements, route_coords, element_type, tag_filter, radius=30):
    """
    Брои OSM елементи от определен тип и с определен таг,
    които са на не повече от `radius` метра от маршрута.

    elements: Overpass резултат (list)
    route_coords: [[lon, lat], ...] извадка от маршрута
    element_type: "node" | "way"
    tag_filter: lambda el -> bool
    radius: метри
    """
    count = 0
    for el in elements:
        if el.get("type") != element_type:
            continue
        if not tag_filter(el):
            continue

        # Вземаме координата на елемента
        if element_type == "node":
            el_lat, el_lon = el.get("lat"), el.get("lon")
            if el_lat is None:
                continue
            # Проверяваме дали е близо до поне една точка от маршрута
            near = any(
                haversine(el_lat, el_lon, c[1], c[0]) <= radius
                for c in route_coords
            )
            if near:
                count += 1

        elif element_type == "way":
            # За way нямаме директни координати в out body (без geometry)
            # Използваме bbox overlap като proxy
            if "bounds" in el:
                b = el["bounds"]
                way_center_lat = (b["minlat"] + b["maxlat"]) / 2
                way_center_lon = (b["minlon"] + b["maxlon"]) / 2
                near = any(
                    haversine(way_center_lat, way_center_lon, c[1], c[0]) <= radius * 3
                    for c in route_coords
                )
                if near:
                    count += 1

    return count


def analyze_route_osm(route):
    """
    Пълен OSM анализ за един маршрут.
    Връща речник с характеристиките на маршрута.
    """
    all_coords = route["coords"]       # [[lon, lat], ...]
    sampled    = sample_coords(all_coords, max_points=40)
    bbox       = bbox_from_coords(all_coords, padding=0.001)

    # Взимаме OSM данни за bbox-а на маршрута
    osm_data = query_overpass(bbox)
    elements = osm_data.get("elements", [])

    # ── Брояч функции ─────────────────────────────────────────────────────────
    def is_stairs(el):
        return el.get("tags", {}).get("highway") == "steps"

    def is_cobble(el):
        return el.get("tags", {}).get("surface") in ("cobblestone", "sett", "gravel", "unpaved", "dirt")

    def is_bad_kerb(el):
        k = el.get("tags", {}).get("kerb", "")
        return k and k not in ("lowered", "flush", "yes", "")

    def is_steep(el):
        inc = el.get("tags", {}).get("incline", "")
        # Парсваме "10%" → 10
        try:
            val = float(inc.replace("%", "").replace("+", "").strip())
            return val >= 8
        except Exception:
            return False

    def is_unlit(el):
        tags = el.get("tags", {})
        return (tags.get("lit") == "no" and
                tags.get("highway") in ("footway", "path", "pedestrian", "sidewalk"))

    def is_footway(el):
        return el.get("tags", {}).get("highway") in ("footway", "path", "pedestrian")

    def is_bench(el):
        return el.get("tags", {}).get("amenity") == "bench"

    def is_toilet(el):
        tags = el.get("tags", {})
        return tags.get("amenity") == "toilets" and tags.get("wheelchair") != "no"

    # ── Броене ────────────────────────────────────────────────────────────────
    stairs_count   = count_near_route(elements, sampled, "way",  is_stairs,   radius=25)
    cobble_count   = count_near_route(elements, sampled, "way",  is_cobble,   radius=25)
    bad_kerb_count = count_near_route(elements, sampled, "node", is_bad_kerb, radius=20)
    steep_count    = count_near_route(elements, sampled, "way",  is_steep,    radius=30)
    unlit_count    = count_near_route(elements, sampled, "way",  is_unlit,    radius=25)
    footway_count  = count_near_route(elements, sampled, "way",  is_footway,  radius=20)
    bench_count    = count_near_route(elements, sampled, "node", is_bench,    radius=50)
    toilet_count   = count_near_route(elements, sampled, "node", is_toilet,   radius=100)

    # ── Нормализирани оценки (0.0 – 1.0, по-ниско = по-лошо) ─────────────────
    distance_km  = route["distance"] / 1000
    duration_min = route["duration"] / 60

    # Повече стълби → по-лошо
    stairs_score   = max(0.0, 1.0 - stairs_count * 0.3)
    # Повече павета → по-лошо
    cobble_score   = max(0.0, 1.0 - cobble_count * 0.2)
    # Повече лоши бордюри → по-лошо
    kerb_score     = max(0.0, 1.0 - bad_kerb_count * 0.15)
    # Повече стръмни участъци → по-лошо
    steep_score    = max(0.0, 1.0 - steep_count * 0.25)
    # Повече неосветени участъци → по-лошо
    lighting_score = max(0.0, 1.0 - unlit_count * 0.2)
    # Повече пешеходни пътеки → по-добре
    footway_score  = min(1.0, footway_count * 0.1)
    # Пейки → бонус
    bench_score    = min(1.0, bench_count * 0.15)
    # Тоалетни → бонус
    toilet_score   = min(1.0, toilet_count * 0.3)

    return {
        # Основни данни
        "index":       route["index"],
        "geojson":     route["geojson"],
        "distance_m":  route["distance"],
        "duration_s":  route["duration"],
        "distance_km": round(distance_km, 2),
        "duration_min": round(duration_min, 1),

        # OSM характеристики (сурови бройки)
        "osm": {
            "stairs_segments":  stairs_count,
            "cobble_segments":  cobble_count,
            "bad_kerbs":        bad_kerb_count,
            "steep_segments":   steep_count,
            "unlit_segments":   unlit_count,
            "footway_segments": footway_count,
            "benches_nearby":   bench_count,
            "accessible_toilets_nearby": toilet_count,
        },

        # Нормализирани оценки за AI
        "scores": {
            "stairs":   round(stairs_score, 2),
            "cobble":   round(cobble_score, 2),
            "kerbs":    round(kerb_score, 2),
            "steep":    round(steep_score, 2),
            "lighting": round(lighting_score, 2),
            "footways": round(footway_score, 2),
            "benches":  round(bench_score, 2),
            "toilets":  round(toilet_score, 2),
        },
    }


# ── Obstacle fetching ─────────────────────────────────────────────────────────

def fetch_active_obstacles():
    """Взима всички активни препятствия от Supabase."""
    try:
        db = get_db()
        result = db.table("reports").select("id,type,latitude,longitude,description,severity").eq("status", "active").execute()
        return [o for o in result.data if o.get("latitude") and o.get("longitude")]
    except Exception as e:
        print(f"[routing] Грешка при четене на препятствия: {e}")
        return []


def count_obstacles_near_route(obstacles, route_coords, radius=50):
    """
    Брои препятствия от DB, които са в радиус от маршрута.
    Връща (count, list_of_nearby_obstacles).
    """
    sampled = sample_coords(route_coords, max_points=40)
    nearby = []
    for obs in obstacles:
        for c in sampled:
            dist = haversine(obs["latitude"], obs["longitude"], c[1], c[0])
            if dist <= radius:
                nearby.append({
                    "type": obs["type"],
                    "description": obs.get("description", ""),
                    "severity": obs.get("severity", "medium"),
                    "distance_m": round(dist),
                })
                break
    return len(nearby), nearby


# ── Main entrypoint ───────────────────────────────────────────────────────────

def get_candidate_routes(from_lat, from_lon, to_lat, to_lon):
    """
    Главна функция — взима маршрути от OSRM и анализира всеки с OSM.
    Зарежда активни препятствия от DB и ги добавя към анализа.
    Връща списък от анализирани маршрути, готови за AI scorer.
    """
    routes = get_osrm_routes(from_lat, from_lon, to_lat, to_lon, alternatives=3)
    obstacles = fetch_active_obstacles()
    if obstacles:
        print(f"[routing] Заредени {len(obstacles)} активни препятствия от DB")

    analyzed = []
    for route in routes:
        try:
            result = analyze_route_osm(route)
        except Exception as e:
            print(f"[routing] Грешка при анализ на маршрут {route['index']}: {e}")
            result = {
                "index":       route["index"],
                "geojson":     route["geojson"],
                "distance_m":  route["distance"],
                "duration_s":  route["duration"],
                "distance_km": round(route["distance"] / 1000, 2),
                "duration_min": round(route["duration"] / 60, 1),
                "osm":    {k: 0 for k in ["stairs_segments","cobble_segments","bad_kerbs","steep_segments","unlit_segments","footway_segments","benches_nearby","accessible_toilets_nearby"]},
                "scores": {k: 0.5 for k in ["stairs","cobble","kerbs","steep","lighting","footways","benches","toilets"]},
            }

        # Добавяме информация за препятствия от DB
        obs_count, obs_nearby = count_obstacles_near_route(obstacles, route["coords"])
        result["osm"]["reported_obstacles"] = obs_count
        result["obstacles_nearby"] = obs_nearby
        # Препятствията намаляват score-а значително
        result["scores"]["obstacles"] = round(max(0.0, 1.0 - obs_count * 0.4), 2)

        analyzed.append(result)

    return analyzed