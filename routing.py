"""
routing.py — EqualPath
Отговаря за:
  1. Вземане на кандидат-маршрути от OSRM (пешеходен профил)
  2. Анализ на всеки маршрут чрез OSM Overpass API
     → брои стълби, павета, тесни пасажи, пешеходни зони и др.
  3. Връща структурирани данни за AI scorer-а
"""

import sys
import requests
import math
from db import get_db

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

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
  way["highway"~"^(primary|secondary|tertiary|trunk)$"]({bb});
  way["leisure"~"^(park|garden)$"]({bb});
  way["tactile_paving"="yes"]["highway"~"^(footway|path|pedestrian|crossing)$"]({bb});
  node["crossing"="traffic_signals"]({bb});
  way["surface"~"^(asphalt|paving_stones|concrete)$"]["highway"~"^(footway|path|pedestrian)$"]({bb});
);
out body bb;
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


def count_significant_turns(coords, min_angle=60):
    """Брои значими промени на посоката (завои > min_angle градуса)."""
    if len(coords) < 3:
        return 0
    sampled = [coords[0]]
    for c in coords[1:]:
        if haversine(sampled[-1][1], sampled[-1][0], c[1], c[0]) >= 50:
            sampled.append(c)
    if len(sampled) < 3:
        return 0
    turns = 0
    for i in range(1, len(sampled) - 1):
        dx1 = sampled[i][0] - sampled[i-1][0]
        dy1 = sampled[i][1] - sampled[i-1][1]
        dx2 = sampled[i+1][0] - sampled[i][0]
        dy2 = sampled[i+1][1] - sampled[i][1]
        cross = dx1 * dy2 - dy1 * dx2
        dot = dx1 * dx2 + dy1 * dy2
        if dot == 0 and cross == 0:
            continue
        angle = abs(math.degrees(math.atan2(cross, dot)))
        if angle >= min_angle:
            turns += 1
    return turns


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

    def is_busy_road(el):
        return el.get("tags", {}).get("highway") in ("primary", "secondary", "tertiary", "trunk")

    def is_park(el):
        return el.get("tags", {}).get("leisure") in ("park", "garden")

    def is_tactile(el):
        tags = el.get("tags", {})
        return tags.get("tactile_paving") == "yes" and tags.get("highway") in ("footway", "path", "pedestrian", "crossing")

    def is_safe_crossing(el):
        return el.get("tags", {}).get("crossing") == "traffic_signals"

    def is_smooth_surface(el):
        tags = el.get("tags", {})
        return (tags.get("surface") in ("asphalt", "paving_stones", "concrete") and
                tags.get("highway") in ("footway", "path", "pedestrian"))

    # ── Броене ────────────────────────────────────────────────────────────────
    stairs_count   = count_near_route(elements, sampled, "way",  is_stairs,   radius=25)
    cobble_count   = count_near_route(elements, sampled, "way",  is_cobble,   radius=25)
    bad_kerb_count = count_near_route(elements, sampled, "node", is_bad_kerb, radius=20)
    steep_count    = count_near_route(elements, sampled, "way",  is_steep,    radius=30)
    unlit_count    = count_near_route(elements, sampled, "way",  is_unlit,    radius=25)
    footway_count  = count_near_route(elements, sampled, "way",  is_footway,  radius=20)
    bench_count    = count_near_route(elements, sampled, "node", is_bench,    radius=50)
    toilet_count   = count_near_route(elements, sampled, "node", is_toilet,   radius=100)
    busy_road_count  = count_near_route(elements, sampled, "way",  is_busy_road,      radius=50)
    park_count       = count_near_route(elements, sampled, "way",  is_park,           radius=50)
    tactile_count    = count_near_route(elements, sampled, "way",  is_tactile,        radius=25)
    safe_cross_count = count_near_route(elements, sampled, "node", is_safe_crossing,  radius=30)
    smooth_count     = count_near_route(elements, sampled, "way",  is_smooth_surface, radius=25)
    turns_count      = count_significant_turns(all_coords)

    # ── Нормализирани оценки (0.0 – 1.0, по-ниско = по-лошо) ─────────────────
    distance_km  = route["distance"] / 1000
    duration_min = route["duration"] / 60

    # Повече стълби → по-лошо
    stairs_score   = max(0.0, 1.0 - stairs_count * 0.7)
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
    # Шум: повече натоварени улици → по-лошо (за аутизъм/сензорно)
    noise_score      = max(0.0, 1.0 - busy_road_count * 0.3)
    # Сложност: повече завои → по-лошо (за аутизъм)
    complexity_score = max(0.0, 1.0 - turns_count * 0.05)
    # Зелени площи → по-добре (за аутизъм/възрастни)
    green_score      = min(1.0, park_count * 0.2)
    # Безопасни кръстовища → по-добре (за зрително затруднени)
    crossing_score   = min(1.0, safe_cross_count * 0.15)
    # Гладка настилка → по-добре (за количка/детска количка)
    smooth_score     = min(1.0, smooth_count * 0.1)
    # Тактилна настилка → по-добре (за зрително затруднени)
    tactile_score    = min(1.0, tactile_count * 0.2)

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
            "busy_roads_nearby":    busy_road_count,
            "parks_nearby":         park_count,
            "tactile_paving":       tactile_count,
            "safe_crossings":       safe_cross_count,
            "smooth_surface":       smooth_count,
            "significant_turns":    turns_count,
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
            "noise":      round(noise_score, 2),
            "complexity": round(complexity_score, 2),
            "green":      round(green_score, 2),
            "crossings":  round(crossing_score, 2),
            "smooth":     round(smooth_score, 2),
            "tactile":    round(tactile_score, 2),
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


def count_obstacles_near_route(obstacles, route_coords, radius=80):
    """
    Брои препятствия от DB, които са в радиус от маршрута.
    Проверява ВСИЧКИ координати на маршрута (не sample) за точност.
    Връща (count, list_of_nearby_obstacles).
    """
    nearby = []
    for obs in obstacles:
        min_dist = float('inf')
        for c in route_coords:
            dist = haversine(obs["latitude"], obs["longitude"], c[1], c[0])
            if dist < min_dist:
                min_dist = dist
            if dist <= radius:
                nearby.append({
                    "type": obs["type"],
                    "description": obs.get("description", ""),
                    "severity": obs.get("severity", "medium"),
                    "distance_m": round(dist),
                })
                break
        if min_dist > radius:
            print(f"[obstacles] Препятствие {obs.get('type','?')} е на {min_dist:.0f}м от маршрута (извън радиус {radius}м)")
    return len(nearby), nearby


# ── Avoidance routing ────────────────────────────────────────────────────────

def _find_obstacles_near_routes(obstacles, routes, radius=80):
    """Намира кои препятствия са близо до поне един от маршрутите."""
    nearby = []
    seen = set()
    for route in routes:
        for obs in obstacles:
            oid = obs.get("id", id(obs))
            if oid in seen:
                continue
            # Проверяваме с ВСИЧКИ координати, не със sample
            for c in route["coords"]:
                if haversine(obs["latitude"], obs["longitude"], c[1], c[0]) <= radius:
                    nearby.append(obs)
                    seen.add(oid)
                    break
    return nearby


def get_avoidance_routes(from_lat, from_lon, to_lat, to_lon, nearby_obstacles, original_routes, next_index):
    """
    Генерира OSRM маршрути, които заобикалят препятствия.
    Използва 3-точков detour по геометрията на оригиналния маршрут:
      точка ПРЕДИ препятствието → отместена точка → точка СЛЕД препятствието
    Това принуждава OSRM да напусне улицата с препятствието.
    """
    if not nearby_obstacles or not original_routes:
        return []

    avoidance = []
    seen_keys = set()

    # Използваме първия (най-кратък) маршрут като reference
    ref_coords = original_routes[0]["coords"]  # [[lon, lat], ...]

    for obs in nearby_obstacles[:3]:
        obs_lat, obs_lon = obs["latitude"], obs["longitude"]

        # 1. Намираме най-близката точка на маршрута до препятствието
        min_dist = float('inf')
        nearest_idx = 0
        for i, c in enumerate(ref_coords):
            d = haversine(obs_lat, obs_lon, c[1], c[0])
            if d < min_dist:
                min_dist = d
                nearest_idx = i

        if min_dist > 150:
            print(f"[avoidance] Препятствие твърде далеч от маршрута ({min_dist:.0f}м), пропускам")
            continue

        print(f"[avoidance] Препятствие на {min_dist:.0f}м от маршрут точка {nearest_idx}/{len(ref_coords)}")

        # 2. Намираме точки ~350м ПРЕДИ и СЛЕД препятствието по маршрута
        before_idx = nearest_idx
        while before_idx > 1:
            before_idx -= 1
            d = haversine(ref_coords[before_idx][1], ref_coords[before_idx][0], obs_lat, obs_lon)
            if d >= 350:
                break

        after_idx = nearest_idx
        while after_idx < len(ref_coords) - 2:
            after_idx += 1
            d = haversine(ref_coords[after_idx][1], ref_coords[after_idx][0], obs_lat, obs_lon)
            if d >= 350:
                break

        before_pt = ref_coords[before_idx]  # [lon, lat]
        after_pt = ref_coords[after_idx]    # [lon, lat]

        # 3. Посока на маршрута при препятствието (за перпендикулярен offset)
        look_back = max(0, nearest_idx - 5)
        look_fwd = min(len(ref_coords) - 1, nearest_idx + 5)
        dx = ref_coords[look_fwd][0] - ref_coords[look_back][0]
        dy = ref_coords[look_fwd][1] - ref_coords[look_back][1]
        seg_len = math.sqrt(dx ** 2 + dy ** 2)

        if seg_len == 0:
            continue

        # Перпендикулярен единичен вектор спрямо ПОСОКАТА НА МАРШРУТА
        perp_dx = -dy / seg_len  # отместване по lon
        perp_dy = dx / seg_len   # отместване по lat

        # 4. Генерираме detour маршрути с различни отмествания
        for offset_deg in [0.003, 0.005, 0.008]:  # ~300м, ~500м, ~800м
            for direction in [1, -1]:  # ляво/дясно
                detour_lat = obs_lat + direction * perp_dy * offset_deg
                detour_lon = obs_lon + direction * perp_dx * offset_deg

                # Междинни точки между before/after и detour (също отместени)
                # Това не позволява на OSRM да се върне през препятствието
                half_offset = offset_deg * 0.5
                mid_before_lat = (before_pt[1] + detour_lat) / 2 + direction * perp_dy * half_offset
                mid_before_lon = (before_pt[0] + detour_lon) / 2 + direction * perp_dx * half_offset
                mid_after_lat  = (after_pt[1] + detour_lat) / 2 + direction * perp_dy * half_offset
                mid_after_lon  = (after_pt[0] + detour_lon) / 2 + direction * perp_dx * half_offset

                wp_key = (round(detour_lat, 4), round(detour_lon, 4))
                if wp_key in seen_keys:
                    continue
                seen_keys.add(wp_key)

                # 5-точков detour: before → mid_before → offset → mid_after → after
                waypoints = (
                    f"{from_lon},{from_lat};"
                    f"{before_pt[0]},{before_pt[1]};"
                    f"{mid_before_lon},{mid_before_lat};"
                    f"{detour_lon},{detour_lat};"
                    f"{mid_after_lon},{mid_after_lat};"
                    f"{after_pt[0]},{after_pt[1]};"
                    f"{to_lon},{to_lat}"
                )
                url = (
                    f"{OSRM_BASE}/{waypoints}"
                    f"?overview=full&geometries=geojson&alternatives=false"
                    f"&steps=true&annotations=false"
                )

                try:
                    resp = requests.get(url, headers=HEADERS, timeout=12)
                    resp.raise_for_status()
                    data = resp.json()
                    if data.get("code") != "Ok" or not data.get("routes"):
                        continue

                    r = data["routes"][0]
                    idx = next_index + len(avoidance)
                    new_dist_km = round(r["distance"] / 1000, 2)
                    avoidance.append({
                        "index":    idx,
                        "geojson":  r["geometry"],
                        "coords":   r["geometry"]["coordinates"],
                        "distance": r["distance"],
                        "duration": r["duration"],
                        "legs":     r.get("legs", []),
                    })
                    print(f"[avoidance] Генериран маршрут {idx}: {new_dist_km}км (offset={offset_deg}, dir={direction})")
                except Exception as e:
                    print(f"[avoidance] OSRM грешка за offset={offset_deg}, dir={direction}: {e}")
                    continue

    print(f"[avoidance] Общо генерирани {len(avoidance)} avoidance маршрута")
    return avoidance


# ── Анализ на един маршрут ───────────────────────────────────────────────────

def _analyze_one_route(route, obstacles):
    """Анализира един маршрут с OSM данни и проверява за препятствия."""
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
            "osm":    {k: 0 for k in ["stairs_segments","cobble_segments","bad_kerbs","steep_segments","unlit_segments","footway_segments","benches_nearby","accessible_toilets_nearby","busy_roads_nearby","parks_nearby","tactile_paving","safe_crossings","smooth_surface","significant_turns"]},
            "scores": {k: 0.5 for k in ["stairs","cobble","kerbs","steep","lighting","footways","benches","toilets","noise","complexity","green","crossings","smooth","tactile"]},
        }

    # Запазваме coords/distance/duration/source от оригиналния маршрут
    result["coords"]   = route["coords"]
    result["distance"] = route["distance"]
    result["duration"] = route["duration"]
    if "source" in route:
        result["source"] = route["source"]

    obs_count, obs_nearby = count_obstacles_near_route(obstacles, route["coords"])
    result["osm"]["reported_obstacles"] = obs_count
    result["obstacles_nearby"] = obs_nearby
    result["scores"]["obstacles"] = round(max(0.0, 1.0 - obs_count * 0.4), 2)
    return result


# ── Profile-specific route generation ─────────────────────────────────────────

# Какво да търсим в Overpass за всеки профил (за генериране на waypoints)
_PROFILE_OVERPASS = {
    "autism": """
        way["leisure"~"^(park|garden)$"]({bb});
        way["landuse"="grass"]({bb});
        way["natural"="wood"]({bb});
        way["highway"="residential"]["maxspeed"~"^(20|30)$"]({bb});
    """,
    "wheelchair": """
        way["surface"~"^(asphalt|paving_stones|concrete)$"]["highway"~"^(footway|path|pedestrian)$"]({bb});
        way["wheelchair"="yes"]({bb});
    """,
    "stroller": """
        way["surface"~"^(asphalt|paving_stones|concrete)$"]["highway"~"^(footway|path|pedestrian)$"]({bb});
    """,
    "visual": """
        way["lit"="yes"]["highway"~"^(footway|path|pedestrian|residential)$"]({bb});
        way["tactile_paving"="yes"]({bb});
    """,
    "elderly": """
        way["leisure"~"^(park|garden)$"]({bb});
        node["amenity"="bench"]({bb});
    """,
}


def _query_profile_waypoints(from_lat, from_lon, to_lat, to_lon, profile):
    """Търси подходящи waypoint-и за даден профил чрез Overpass."""
    if profile not in _PROFILE_OVERPASS:
        return []

    padding = 0.01
    bbox = {
        "south": min(from_lat, to_lat) - padding,
        "north": max(from_lat, to_lat) + padding,
        "west":  min(from_lon, to_lon) - padding,
        "east":  max(from_lon, to_lon) + padding,
    }
    s, n, w, e = bbox["south"], bbox["north"], bbox["west"], bbox["east"]
    bb = f"{s},{w},{n},{e}"

    body = _PROFILE_OVERPASS[profile].replace("{bb}", bb)
    query = f"[out:json][timeout:10];\n({body});\nout center;"

    try:
        resp = requests.post(OVERPASS_BASE, data={"data": query}, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        return resp.json().get("elements", [])
    except Exception as e:
        print(f"[profile-routing] Overpass грешка за {profile}: {e}")
        return []


def _osrm_via_waypoint(from_lat, from_lon, to_lat, to_lon, wp_lat, wp_lon):
    """Праща OSRM заявка с една via-точка. Връща route dict или None."""
    coords = f"{from_lon},{from_lat};{wp_lon},{wp_lat};{to_lon},{to_lat}"
    url = (
        f"{OSRM_BASE}/{coords}"
        f"?overview=full&geometries=geojson&alternatives=false"
        f"&steps=true&annotations=false"
    )
    try:
        resp = requests.get(url, headers=HEADERS, timeout=12)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        r = data["routes"][0]
        return {
            "geojson":  r["geometry"],
            "coords":   r["geometry"]["coordinates"],
            "distance": r["distance"],
            "duration": r["duration"],
            "legs":     r.get("legs", []),
        }
    except Exception:
        return None


def _generate_profile_routes(from_lat, from_lon, to_lat, to_lon, profile, next_index):
    """
    Генерира профил-специфични маршрути чрез Overpass waypoints
    (паркове за аутизъм, гладки пътеки за количка, и т.н.).
    """
    if profile not in _PROFILE_OVERPASS:
        return []

    elements = _query_profile_waypoints(from_lat, from_lon, to_lat, to_lon, profile)
    centers = []
    for el in elements:
        if "center" in el:
            centers.append((el["center"]["lat"], el["center"]["lon"]))
        elif el.get("lat") and el.get("lon"):
            centers.append((el["lat"], el["lon"]))

    mid_lat = (from_lat + to_lat) / 2
    mid_lon = (from_lon + to_lon) / 2
    centers.sort(key=lambda c: haversine(c[0], c[1], mid_lat, mid_lon))

    routes = []
    seen_distances = set()

    for wlat, wlon in centers[:10]:
        if len(routes) >= 6:
            break
        if haversine(wlat, wlon, from_lat, from_lon) < 80:
            continue
        if haversine(wlat, wlon, to_lat, to_lon) < 80:
            continue
        r = _osrm_via_waypoint(from_lat, from_lon, to_lat, to_lon, wlat, wlon)
        if not r:
            continue
        dist_key = round(r["distance"] / 50)
        if dist_key in seen_distances:
            continue
        seen_distances.add(dist_key)
        idx = next_index + len(routes)
        r["index"] = idx
        r["source"] = f"profile-{profile}"
        routes.append(r)
        print(f"[profile-routing] Маршрут {idx} (overpass-{profile}): {round(r['distance']/1000,2)}км")

    print(f"[profile-routing] Общо {len(routes)} допълнителни маршрута за '{profile}'")
    return routes


# ── Profile hard constraints ──────────────────────────────────────────────────

# Дефинира кои OSM метрики са КРИТИЧНИ за всеки профил.
# "max" = максимален допустим брой (над него маршрутът е дисквалифициран).
# "score_floor" = ако score-а падне под тази стойност, маршрутът се наказва тежко.
_PROFILE_HARD_CONSTRAINTS = {
    "wheelchair": {
        # Стълбите са абсолютно непреодолими
        "stairs_segments":  {"max": 0, "penalty_per": 0.5},
        # Павета и лоши бордюри са много проблематични
        "cobble_segments":  {"max": 1, "penalty_per": 0.15},
        "bad_kerbs":        {"max": 1, "penalty_per": 0.15},
        "steep_segments":   {"max": 0, "penalty_per": 0.2},
    },
    "autism": {
        # Шумните улици и тълпите са критични
        "busy_roads_nearby": {"max": 2, "penalty_per": 0.15},
        # Сложните маршрути са проблематични
        "significant_turns": {"max": 8, "penalty_per": 0.05},
    },
    "stroller": {
        # Стълбите са непреодолими
        "stairs_segments":  {"max": 0, "penalty_per": 0.5},
        # Павета са много неудобни
        "cobble_segments":  {"max": 1, "penalty_per": 0.15},
        "bad_kerbs":        {"max": 1, "penalty_per": 0.12},
    },
    "visual": {
        # Неосветени участъци са опасни
        "unlit_segments":   {"max": 1, "penalty_per": 0.2},
        "bad_kerbs":        {"max": 2, "penalty_per": 0.1},
    },
    "elderly": {
        "steep_segments":   {"max": 1, "penalty_per": 0.15},
        "stairs_segments":  {"max": 1, "penalty_per": 0.2},
    },
}

# Бонуси: кои score-ове трябва да са ВИСОКИ за всеки профил
_PROFILE_BONUSES = {
    "wheelchair": {"smooth": 0.15, "footways": 0.05},
    "autism":     {"green": 0.2, "noise": 0.15, "complexity": 0.1},
    "stroller":   {"smooth": 0.15, "footways": 0.05},
    "visual":     {"tactile": 0.2, "lighting": 0.15, "crossings": 0.1},
    "elderly":    {"benches": 0.1, "green": 0.1},
}


def _apply_profile_penalties(analyzed, profile, needs):
    """
    Прилага профил-специфични наказания и бонуси към score-овете на маршрутите.
    Това позволява на AI scorer-а (и fallback-а) да избере правилния маршрут.
    """
    constraints = _PROFILE_HARD_CONSTRAINTS.get(profile, {})
    bonuses = _PROFILE_BONUSES.get(profile, {})

    if not constraints and not bonuses:
        return analyzed

    for route in analyzed:
        osm = route.get("osm", {})
        scores = route.get("scores", {})
        penalty = 0.0

        # Hard constraints: наказваме маршрути, които нарушават критични изисквания
        for metric, rule in constraints.items():
            count = osm.get(metric, 0)
            limit = rule["max"]
            if count > limit:
                excess = count - limit
                penalty += excess * rule["penalty_per"]

        # Бонуси: повишаваме scores за маршрути с добри характеристики
        bonus = 0.0
        for score_key, weight in bonuses.items():
            val = scores.get(score_key, 0.0)
            bonus += val * weight

        # Прилагаме penalty като намаление на всички scores пропорционално
        if penalty > 0:
            factor = max(0.05, 1.0 - penalty)
            for key in scores:
                scores[key] = round(scores[key] * factor, 3)
            route["profile_penalty"] = round(penalty, 2)
            print(f"[profile] Маршрут {route['index']}: penalty={penalty:.2f} (factor={factor:.2f}) за профил '{profile}'")

        # Прилагаме бонуси
        if bonus > 0:
            for key in scores:
                scores[key] = round(min(1.0, scores[key] + bonus * 0.3), 3)
            print(f"[profile] Маршрут {route['index']}: bonus={bonus:.2f} за профил '{profile}'")

    return analyzed


# ── Main entrypoint ───────────────────────────────────────────────────────────

def get_candidate_routes(from_lat, from_lon, to_lat, to_lon, profile="general", needs=None):
    """
    Главна функция — взима маршрути от OSRM и анализира всеки с OSM.
    Генерира профил-специфични алтернативни маршрути (през паркове за аутизъм,
    по гладки пътеки за количка, и т.н.).
    Зарежда активни препятствия от DB и ги добавя към анализа.
    Ако всички маршрути минават през препятствия — генерира допълнителни
    avoidance маршрути с via-waypoints, за да ги заобиколи.
    Връща списък от анализирани маршрути, готови за AI scorer.
    """
    if needs is None:
        needs = []

    routes = get_osrm_routes(from_lat, from_lon, to_lat, to_lon, alternatives=3)

    # Профил-специфични допълнителни маршрути от Overpass
    profile_routes = _generate_profile_routes(
        from_lat, from_lon, to_lat, to_lon, profile, next_index=len(routes)
    )
    routes.extend(profile_routes)

    print(f"[routing] {len(routes)} кандидат-маршрута (OSRM + profile)")

    obstacles = fetch_active_obstacles()
    print(f"[routing] Заредени {len(obstacles)} активни препятствия от DB")

    analyzed = [_analyze_one_route(route, obstacles) for route in routes]

    # Ако поне един маршрут минава през препятствие → генерираме avoidance
    any_has_obstacles = any(r["osm"].get("reported_obstacles", 0) > 0 for r in analyzed)

    if any_has_obstacles:
        has_clean = any(r["osm"].get("reported_obstacles", 0) == 0 for r in analyzed)
        if has_clean:
            print("[routing] Има чист маршрут сред OSRM алтернативите — ще бъде избран от AI scorer")
        else:
            print("[routing] ВСИЧКИ OSRM маршрути минават през препятствия — генерирам avoidance...")
            nearby_obs = _find_obstacles_near_routes(obstacles, routes)
            print(f"[avoidance] Намерени {len(nearby_obs)} препятствия близо до маршрутите")
            avoidance_routes = get_avoidance_routes(
                from_lat, from_lon, to_lat, to_lon,
                nearby_obs, routes, next_index=len(routes)
            )
            for route in avoidance_routes:
                result = _analyze_one_route(route, obstacles)
                route_obs = result["osm"].get("reported_obstacles", 0)
                analyzed.append(result)
                status = "✓ ЧИСТ" if route_obs == 0 else f"⚠ {route_obs} препятствия"
                print(f"[avoidance] Маршрут {result['index']}: {result['distance_km']}км — {status}")

    # ── Профил-специфични наказания (hard constraints) ──────────────────────
    analyzed = _apply_profile_penalties(analyzed, profile, needs)

    # Логваме финалното разпределение
    print(f"\n[routing] ══ {len(analyzed)} кандидат-маршрута ══")
    for r in analyzed:
        obs = r["osm"].get("reported_obstacles", 0)
        pen = r.get("profile_penalty", 0)
        marker = "✓" if obs == 0 else "✗"
        pen_str = f", penalty={pen}" if pen > 0 else ""
        print(f"[routing] {marker} Маршрут {r['index']}: {r['distance_km']}км, {obs} препятстви{'е' if obs == 1 else 'я'}, obstacle_score={r['scores'].get('obstacles', '?')}{pen_str}")

    return analyzed
