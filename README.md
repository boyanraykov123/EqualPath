# EqualPath Backend

Python Flask backend с Grok (xAI) за достъпна навигация.

---

## Бърз старт (5 стъпки)

### 1. Инсталирай Flask и библиотеките

Отвори терминал в папката на проекта и изпълни:

```bash
pip install -r requirements.txt
```

### 2. Вземи безплатен Grok API ключ

1. Отиди на → https://docs.x.ai/developers/models
2. Копирай ключа

### 3. Създай `.env` файл

```bash
# Копирай шаблона
cp .env.example .env
```

После отвори `.env` и замени `your_gemini_api_key_here` с реалния ключ:

```
GEMINI_API_KEY=AIzaSy...твоя_ключ_тук
FLASK_ENV=development
FLASK_PORT=5000
```

### 4. Стартирай сървъра

```bash
python app.py
```

Трябва да видиш:
```
╔══════════════════════════════════════╗
║   EqualPath Backend  v1.0            ║
║   http://localhost:5000              ║
╚══════════════════════════════════════╝
```

### 5. Провери дали работи

Отвори в браузъра: http://localhost:5000/api/health

Трябва да върне:
```json
{"status": "ok", "gemini": "configured", ...}
```

---

## API Ендпойнти

### `POST /api/route`

Взима най-удобния маршрут за потребителя.

**Request:**
```json
{
  "from":    { "lat": 42.6977, "lng": 23.3219 },
  "to":      { "lat": 42.7100, "lng": 23.3300 },
  "profile": "wheelchair",
  "needs":   ["no-stairs", "no-cobble"],
  "notes":   "Използвам проходилка"
}
```

**Response:**
```json
{
  "ok": true,
  "geojson": { "type": "LineString", "coordinates": [...] },
  "distance_km": 1.23,
  "duration_min": 15.0,
  "comfort_index": 8.4,
  "reason": "Избран е маршрут 2 защото...",
  "warning": null,
  "route_summary": "1.23 км, 15 мин",
  "osm_data": {
    "stairs_segments": 0,
    "cobble_segments": 1,
    ...
  }
}
```

### `POST /api/obstacles`

Приема доклад за препятствие.

```json
{
  "type": "construction",
  "description": "Строителни работи блокират тротоара",
  "latlng": { "lat": 42.697, "lng": 23.321 },
  "reporter": "Иван"
}
```

### `GET /api/health`

Проверка на статуса на сървъра.

---

## Архитектура

```
POST /api/route
      │
      ▼
routing.py
  1. OSRM Public API → 3 кандидат-маршрута (пешеходни)
  2. OSM Overpass API → анализира всеки маршрут
     - стълби, павета, бордюри, наклони, осветление
      │
      ▼
ai_scorer.py
  3. Gemini 1.5 Flash → избира най-удобния маршрут
     - взима OSM данните + потребителски профил
     - връща Comfort Index + обяснение на български
      │
      ▼
app.py → JSON отговор към Frontend
```

---

## Профили

| Профил | Описание |
|--------|----------|
| `wheelchair` | Инвалидна количка — стълбите са абсолютно непреодолими |
| `autism` | Аутизъм/Сензорно — приоритет тихи улици |
| `stroller` | Детска количка — без стълби и павета |
| `general` | Стандартен пешеходен маршрут |
