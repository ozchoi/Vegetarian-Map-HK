import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import { createWorker } from "tesseract.js";
import "leaflet/dist/leaflet.css";
import {
  Archive,
  Check,
  Download,
  Leaf,
  LocateFixed,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
  Utensils,
  X,
} from "lucide-react";
import { seedRestaurants } from "./seedRestaurants";
import "./styles.css";

const STORAGE_KEY = "hk-veg-map-restaurants-v4";

function loadRestaurants() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return seedRestaurants;

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) && parsed.length ? parsed : seedRestaurants;
  } catch {
    return seedRestaurants;
  }
}

function parseMenuText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const vegetarian = /素|齋|vegan|vegetarian|plant|植物|豆腐|蘑菇|mushroom/i.test(line);
      const priceMatch = line.match(/(\$?\d+(?:\.\d{1,2})?)/);
      const name = line.replace(/\s*[-,，|]?\s*\$?\d+(?:\.\d{1,2})?$/, "").trim();
      return {
        name: name || line,
        price: priceMatch ? priceMatch[1].replace(/^([^$])/, "$$$1") : "",
        vegetarian,
      };
    });
}

function isWithinBounds(restaurant, bounds) {
  if (!bounds) return true;
  return (
    restaurant.lat <= bounds.north &&
    restaurant.lat >= bounds.south &&
    restaurant.lng <= bounds.east &&
    restaurant.lng >= bounds.west
  );
}

function matchesHoursFilter(restaurant, hoursFilter) {
  if (hoursFilter === "all") return true;
  if (hoursFilter === "has-hours") return Boolean(restaurant.hours);
  if (!restaurant.hours) return false;

  const times = [...restaurant.hours.matchAll(/(\d{1,2}):(\d{2})/g)].map((match) => ({
    hour: Number(match[1]),
    minute: Number(match[2]),
  }));

  if (hoursFilter === "early") {
    return times.some((time) => time.hour < 10 || (time.hour === 10 && time.minute === 0));
  }

  if (hoursFilter === "late") {
    return times.some((time) => time.hour >= 21);
  }

  return true;
}

const DISTRICT_CENTERS = [
  ["中環", 22.2819, 114.1586, ["Central", "中環"]],
  ["金鐘", 22.2799, 114.1655, ["Admiralty", "金鐘"]],
  ["灣仔", 22.2783, 114.1747, ["Wan Chai", "灣仔"]],
  ["銅鑼灣", 22.2802, 114.1843, ["Causeway Bay", "銅鑼灣"]],
  ["北角", 22.2915, 114.2006, ["North Point", "北角"]],
  ["太古", 22.2868, 114.2178, ["Taikoo", "太古"]],
  ["尖沙咀", 22.2976, 114.1722, ["Tsim Sha Tsui", "尖沙咀"]],
  ["西九", 22.2991, 114.1596, ["West Kowloon", "西九"]],
  ["佐敦", 22.3043, 114.1716, ["Jordan", "佐敦"]],
  ["油麻地", 22.3133, 114.1709, ["Yau Ma Tei", "油麻地"]],
  ["旺角", 22.3193, 114.1694, ["Mong Kok", "旺角"]],
  ["太子", 22.3245, 114.1687, ["Prince Edward", "太子"]],
  ["深水埗", 22.3305, 114.1622, ["Sham Shui Po", "深水埗"]],
  ["荔枝角", 22.3377, 114.148, ["Lai Chi Kok", "荔枝角"]],
  ["黃埔", 22.3051, 114.1906, ["Whampoa", "黃埔", "紅磡"]],
  ["九龍城", 22.3282, 114.1887, ["Kowloon City", "九龍城"]],
  ["鑽石山", 22.3402, 114.2017, ["Diamond Hill", "鑽石山"]],
  ["黃大仙", 22.3417, 114.1943, ["Wong Tai Sin", "黃大仙"]],
  ["觀塘", 22.312, 114.226, ["Kwun Tong", "觀塘"]],
  ["荃灣", 22.3717, 114.1131, ["Tsuen Wan", "荃灣"]],
  ["葵涌", 22.3639, 114.1314, ["Kwai Chung", "葵涌", "葵興"]],
  ["馬鞍山", 22.424, 114.231, ["Ma On Shan", "馬鞍山"]],
];

function inferDistrictFromAddress(address) {
  const lowered = address.toLowerCase();
  return DISTRICT_CENTERS.find(([district, , , aliases]) =>
    [district, ...aliases].some((alias) => lowered.includes(alias.toLowerCase())),
  )?.[0] || "";
}

function inferDistrictFromCoords(lat, lng) {
  let best = DISTRICT_CENTERS[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  DISTRICT_CENTERS.forEach((center) => {
    const distance = (lat - center[1]) ** 2 + (lng - center[2]) ** 2;
    if (distance < bestDistance) {
      best = center;
      bestDistance = distance;
    }
  });

  return best[0];
}

function parseGoogleMapsLocation(value) {
  const text = value.trim();
  const atMatch = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) return { lat: Number(atMatch[1]), lng: Number(atMatch[2]) };

  const bangMatch = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (bangMatch) return { lat: Number(bangMatch[1]), lng: Number(bangMatch[2]) };

  const queryMatch = text.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (queryMatch) return { lat: Number(queryMatch[1]), lng: Number(queryMatch[2]) };

  return null;
}

async function geocodeAddress(address) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "hk");
  url.searchParams.set("q", address);

  const response = await fetch(url);
  if (!response.ok) throw new Error("Geocoding failed");
  const [result] = await response.json();
  if (!result) throw new Error("No geocoding result");

  return {
    lat: Number(result.lat),
    lng: Number(result.lon),
    displayName: result.display_name,
  };
}

async function reverseGeocode(lat, lng) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));

  const response = await fetch(url);
  if (!response.ok) throw new Error("Reverse geocoding failed");
  return response.json();
}

function App() {
  const [restaurants, setRestaurants] = useState(loadRestaurants);
  const [selectedId, setSelectedId] = useState(restaurants[0]?.id);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [advancedFilters, setAdvancedFilters] = useState({
    district: "all",
    cuisine: "all",
    hours: "all",
  });
  const [showFilters, setShowFilters] = useState(false);
  const [mapBounds, setMapBounds] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(restaurants));
  }, [restaurants]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const filterOptions = useMemo(() => {
    const districts = [...new Set(restaurants.map((restaurant) => restaurant.district).filter(Boolean))].sort();
    const cuisines = [...new Set(restaurants.map((restaurant) => restaurant.cuisine).filter(Boolean))].sort();
    return { districts, cuisines };
  }, [restaurants]);

  const filteredRestaurants = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return restaurants.filter((restaurant) => {
      const matchesFilter = filter === "all" || restaurant.category === filter;
      const matchesDistrict =
        advancedFilters.district === "all" || restaurant.district === advancedFilters.district;
      const matchesCuisine =
        advancedFilters.cuisine === "all" || restaurant.cuisine === advancedFilters.cuisine;
      const matchesHours = matchesHoursFilter(restaurant, advancedFilters.hours);
      const matchesQuery =
        !lowered ||
        [restaurant.name, restaurant.address, restaurant.district, restaurant.notes]
          .concat([
            restaurant.archiveName,
            restaurant.brand,
            restaurant.phone,
            restaurant.hours,
            restaurant.status,
            restaurant.menuSource,
            restaurant.cuisine,
            restaurant.sourceConfidence,
          ])
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(lowered));
      return matchesFilter && matchesDistrict && matchesCuisine && matchesHours && matchesQuery;
    });
  }, [advancedFilters, filter, query, restaurants]);

  const visibleRestaurants = useMemo(
    () => filteredRestaurants.filter((restaurant) => isWithinBounds(restaurant, mapBounds)),
    [filteredRestaurants, mapBounds],
  );

  const selectedRestaurant =
    restaurants.find((restaurant) => restaurant.id === selectedId) || visibleRestaurants[0] || filteredRestaurants[0];

  const activeFilterCount = [
    filter !== "all",
    advancedFilters.district !== "all",
    advancedFilters.cuisine !== "all",
    advancedFilters.hours !== "all",
  ].filter(Boolean).length;

  function updateAdvancedFilter(field, value) {
    setAdvancedFilters((current) => ({ ...current, [field]: value }));
  }

  function resetFilters() {
    setQuery("");
    setFilter("all");
    setAdvancedFilters({ district: "all", cuisine: "all", hours: "all" });
  }

  function addRestaurant(restaurant) {
    setRestaurants((current) => [restaurant, ...current]);
    setSelectedId(restaurant.id);
    setShowAdd(false);
    setToast("已加入餐廳");
  }

  function importArchive(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) throw new Error("Archive must be an array");
        setRestaurants(parsed);
        setSelectedId(parsed[0]?.id);
        setToast("已載入 archive");
      } catch {
        setToast("Archive 格式唔正確");
      }
    };
    reader.readAsText(file);
  }

  function exportArchive() {
    const blob = new Blob([JSON.stringify(restaurants, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hk-veg-map-archive-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Leaf size={20} />
          </span>
          <div>
            <h1>香港素食地圖</h1>
            <p>素食餐廳同一般餐廳素食選擇，一個地方整理。</p>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="icon-button file-button" title="匯入 archive">
            <Upload size={18} />
            <input accept="application/json" type="file" onChange={(event) => importArchive(event.target.files?.[0])} />
          </label>
          <button className="icon-button" type="button" onClick={exportArchive} title="下載 archive">
            <Download size={18} />
          </button>
          <button className="icon-button" type="button" onClick={() => setShowFilters(true)} title="篩選">
            <SlidersHorizontal size={18} />
          </button>
          <button className="primary-button" type="button" onClick={() => setShowAdd(true)}>
            <Plus size={18} />
            新餐廳
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="map-region" aria-label="香港餐廳地圖">
          <RestaurantMap
            restaurants={filteredRestaurants}
            selectedRestaurant={selectedRestaurant}
            onSelect={setSelectedId}
            onBoundsChange={setMapBounds}
          />
        </section>

        <section className="results-region">
          <aside className="sidebar" aria-label="餐廳列表">
            <div className="list-tools">
              <div className="searchbox">
                <Search size={17} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋餐廳、地區、地址" />
              </div>
              <button className="secondary-button filter-button" type="button" onClick={() => setShowFilters(true)}>
                <SlidersHorizontal size={17} />
                篩選{activeFilterCount ? ` ${activeFilterCount}` : ""}
              </button>
            </div>

            <div className="segmented" aria-label="餐廳類型">
              {[
                ["all", "全部"],
                ["vegetarian", "素食"],
                ["mixed", "有素食"],
              ].map(([value, label]) => (
                <button
                  className={filter === value ? "active" : ""}
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="summary-row">
              <span>{visibleRestaurants.length} 間喺目前地圖範圍</span>
              <span>
                <Archive size={14} /> {filteredRestaurants.length} matched
              </span>
            </div>

            <div className="restaurant-list">
              {visibleRestaurants.map((restaurant) => (
                <button
                  className={`restaurant-row ${selectedRestaurant?.id === restaurant.id ? "selected" : ""}`}
                  key={restaurant.id}
                  type="button"
                  onClick={() => setSelectedId(restaurant.id)}
                >
                  <span className={`row-pin ${restaurant.category}`}>
                    {restaurant.category === "vegetarian" ? <Leaf size={15} /> : <Utensils size={15} />}
                  </span>
                  <span>
                    <strong>{restaurant.name}</strong>
                    <small>
                      {[restaurant.district || restaurant.address, restaurant.hours]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <RestaurantDetails restaurant={selectedRestaurant} />
        </section>

        {showFilters && (
          <div className="filter-backdrop" role="presentation" onClick={() => setShowFilters(false)}>
            <aside className="filter-drawer" aria-label="篩選選項" onClick={(event) => event.stopPropagation()}>
              <div className="filter-title">
                <div>
                  <h2>篩選</h2>
                  <p>收窄地圖同列表結果。</p>
                </div>
                <button className="icon-button" type="button" onClick={() => setShowFilters(false)} title="關閉">
                  <X size={18} />
                </button>
              </div>

              <label>
                地區
                <select value={advancedFilters.district} onChange={(event) => updateAdvancedFilter("district", event.target.value)}>
                  <option value="all">全部地區</option>
                  {filterOptions.districts.map((district) => (
                    <option key={district} value={district}>{district}</option>
                  ))}
                </select>
              </label>

              <label>
                餐廳類型
                <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                  <option value="all">全部</option>
                  <option value="vegetarian">素食餐廳</option>
                  <option value="mixed">一般餐廳（有素食選擇）</option>
                </select>
              </label>

              <label>
                菜系
                <select value={advancedFilters.cuisine} onChange={(event) => updateAdvancedFilter("cuisine", event.target.value)}>
                  <option value="all">全部菜系</option>
                  {filterOptions.cuisines.map((cuisine) => (
                    <option key={cuisine} value={cuisine}>{cuisine}</option>
                  ))}
                </select>
              </label>

              <label>
                營業時間
                <select value={advancedFilters.hours} onChange={(event) => updateAdvancedFilter("hours", event.target.value)}>
                  <option value="all">全部</option>
                  <option value="has-hours">有營業時間資料</option>
                  <option value="early">10:00 或之前開始</option>
                  <option value="late">21:00 或之後仍營業</option>
                </select>
              </label>

              <div className="filter-actions">
                <button className="secondary-button" type="button" onClick={resetFilters}>重設</button>
                <button className="primary-button" type="button" onClick={() => setShowFilters(false)}>套用</button>
              </div>
            </aside>
          </div>
        )}
      </main>

      {showAdd && <AddRestaurantModal onClose={() => setShowAdd(false)} onAdd={addRestaurant} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function RestaurantMap({ restaurants, selectedRestaurant, onSelect, onBoundsChange }) {
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    mapRef.current = L.map(mapNodeRef.current, {
      center: [22.3027, 114.1772],
      zoom: 12,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(mapRef.current);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(mapRef.current);

    const reportBounds = () => {
      const bounds = mapRef.current.getBounds();
      onBoundsChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      });
    };

    mapRef.current.on("moveend zoomend", reportBounds);
    reportBounds();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = restaurants.map((restaurant) => {
      const isSelected = selectedRestaurant?.id === restaurant.id;
      const marker = L.marker([restaurant.lat, restaurant.lng], {
        icon: L.divIcon({
          className: "",
          html: `<span class="map-marker ${restaurant.category} ${isSelected ? "selected" : ""}">${restaurant.category === "vegetarian" ? "素" : "可"}</span>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      });
      marker.bindTooltip(restaurant.name);
      marker.on("click", () => onSelect(restaurant.id));
      marker.addTo(map);
      return marker;
    });
  }, [onSelect, restaurants, selectedRestaurant]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedRestaurant) return;
    map.flyTo([selectedRestaurant.lat, selectedRestaurant.lng], Math.max(map.getZoom(), 14), {
      duration: 0.8,
    });
  }, [selectedRestaurant]);

  return (
    <>
      <div className="map-canvas" ref={mapNodeRef} />
      <div className="legend">
        <span><i className="dot vegetarian" /> 素食餐廳</span>
        <span><i className="dot mixed" /> 一般餐廳素食選擇</span>
      </div>
    </>
  );
}

function RestaurantDetails({ restaurant }) {
  if (!restaurant) {
    return (
      <aside className="details-panel empty">
        <MapPin />
        <p>未有符合條件嘅餐廳。</p>
      </aside>
    );
  }

  const vegCount = restaurant.menuItems.filter((item) => item.vegetarian).length;

  return (
    <aside className="details-panel" aria-label="餐廳詳情">
      <div className="details-header">
        <span className={`type-badge ${restaurant.category}`}>
          {restaurant.category === "vegetarian" ? "素食餐廳" : "一般餐廳"}
        </span>
        <h2>{restaurant.name}</h2>
        {restaurant.brand && restaurant.brand !== restaurant.name && (
          <p className="brand-line">{restaurant.brand}</p>
        )}
        <p><MapPin size={15} /> {restaurant.address}</p>
        {restaurant.cuisine && <p className="cuisine-line">{restaurant.cuisine}</p>}
      </div>

      <div className="stat-grid">
        <div>
          <strong>{restaurant.menuItems.length}</strong>
          <span>Menu items</span>
        </div>
        <div>
          <strong>{vegCount}</strong>
          <span>素食 options</span>
        </div>
      </div>

      <div className="metadata-grid">
        {restaurant.archiveName && (
          <div>
            <span>Archive</span>
            <strong>{restaurant.archiveName}</strong>
          </div>
        )}
        {restaurant.phone && (
          <div>
            <span>電話</span>
            <strong>{restaurant.phone}</strong>
          </div>
        )}
        {restaurant.hours && (
          <div>
            <span>營業時間</span>
            <strong>{restaurant.hours}</strong>
          </div>
        )}
        {restaurant.status && (
          <div>
            <span>狀態</span>
            <strong>{restaurant.status}</strong>
          </div>
        )}
      </div>

      {restaurant.notes && <p className="notes">{restaurant.notes}</p>}

      {(restaurant.sourceConfidence || restaurant.sourceUrl) && (
        <div className="source-box">
          {restaurant.sourceConfidence && <span>{restaurant.sourceConfidence}</span>}
          {restaurant.sourceUrl && (
            <a href={restaurant.sourceUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
        </div>
      )}

      <div className="menu-heading">
        <h3>Menu</h3>
        <span>更新 {restaurant.menuUpdatedAt}</span>
      </div>

      <div className="menu-list">
        {restaurant.menuItems.map((item, index) => (
          <div className={`menu-item ${item.vegetarian ? "vegetarian" : ""}`} key={`${item.name}-${index}`}>
            <span>
              {item.vegetarian && <Check size={15} />}
              {item.name}
            </span>
            <strong>{item.price}</strong>
          </div>
        ))}
      </div>
    </aside>
  );
}

function AddRestaurantModal({ onAdd, onClose }) {
  const [form, setForm] = useState({
    name: "",
    category: "mixed",
    address: "",
    district: "",
    lat: "",
    lng: "",
    notes: "",
    menuText: "",
  });
  const [ocrStatus, setOcrStatus] = useState("");
  const [locationStatus, setLocationStatus] = useState("");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function resolveTypedAddress() {
    const input = form.address.trim();
    if (!input) {
      setLocationStatus("請先貼 Google Maps link 或輸入地址。");
      return null;
    }

    const parsed = parseGoogleMapsLocation(input);
    if (parsed) {
      const district = inferDistrictFromAddress(input) || inferDistrictFromCoords(parsed.lat, parsed.lng);
      setForm((current) => ({
        ...current,
        lat: String(parsed.lat),
        lng: String(parsed.lng),
        district,
      }));
      setLocationStatus(`已讀取座標，地區推算為 ${district}`);
      return { ...parsed, district, address: input };
    }

    if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(input)) {
      setLocationStatus("短 Google Maps link 未必包含座標；請用分享頁入面完整地址，或用目前位置。");
      return null;
    }

    setLocationStatus("正在用地址搜尋位置...");
    try {
      const result = await geocodeAddress(input);
      const district = inferDistrictFromAddress(input) || inferDistrictFromCoords(result.lat, result.lng);
      setForm((current) => ({
        ...current,
        address: current.address || result.displayName,
        lat: String(result.lat),
        lng: String(result.lng),
        district,
      }));
      setLocationStatus(`已搜尋位置，地區推算為 ${district}`);
      return { ...result, district, address: input };
    } catch {
      setLocationStatus("未能由地址搵到位置，請貼包含座標嘅 Google Maps link 或使用目前位置。");
      return null;
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("呢個 browser 未支援目前位置。");
      return;
    }

    setLocationStatus("正在讀取目前位置...");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const district = inferDistrictFromCoords(lat, lng);
        let address = `Current location (${lat.toFixed(6)}, ${lng.toFixed(6)})`;

        try {
          const result = await reverseGeocode(lat, lng);
          address = result.display_name || address;
        } catch {
          // Keep coordinate fallback if reverse geocoding is unavailable.
        }

        setForm((current) => ({
          ...current,
          address,
          district,
          lat: String(lat),
          lng: String(lng),
        }));
        setLocationStatus(`已使用目前位置，地區推算為 ${district}`);
      },
      () => setLocationStatus("未能讀取目前位置，請確認已允許 location permission。"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  async function extractImageText(file) {
    setOcrStatus("讀取圖片文字中...");
    let worker;
    try {
      worker = await createWorker("eng+chi_tra");
      const {
        data: { text },
      } = await worker.recognize(file);
      updateField("menuText", text.trim());
      setOcrStatus("已將圖片文字填入 Menu text");
    } catch {
      setOcrStatus("OCR 未能讀取呢張圖片，請試清晰啲嘅相或手動貼上文字。");
    } finally {
      if (worker) await worker.terminate();
    }
  }

  function uploadMenu(file) {
    if (!file) return;
    if (file.type.startsWith("image/")) {
      void extractImageText(file);
      return;
    }

    setOcrStatus("");
    const reader = new FileReader();
    reader.onload = () => updateField("menuText", String(reader.result || ""));
    reader.readAsText(file);
  }

  async function submit(event) {
    event.preventDefault();
    let lat = Number(form.lat);
    let lng = Number(form.lng);
    let district = form.district;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const resolved = await resolveTypedAddress();
      if (!resolved) return;
      lat = resolved.lat;
      lng = resolved.lng;
      district = resolved.district;
    }

    const menuItems = parseMenuText(form.menuText);
    onAdd({
      id: crypto.randomUUID(),
      name: form.name.trim(),
      category: form.category,
      address: form.address.trim(),
      district: district || inferDistrictFromCoords(lat, lng),
      lat,
      lng,
      notes: form.notes.trim(),
      cuisine: "",
      sourceConfidence: "User uploaded menu",
      sourceUrl: "",
      menuUpdatedAt: new Date().toISOString().slice(0, 10),
      menuItems: menuItems.length ? menuItems : [{ name: "待補 menu", price: "", vegetarian: form.category === "vegetarian" }],
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={submit}>
        <div className="modal-title">
          <div>
            <h2>加入新餐廳</h2>
            <p>填餐廳名，用 Google Maps link 或目前位置加入地圖。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="關閉">
            <X size={18} />
          </button>
        </div>

        <div className="form-grid">
          <label>
            餐廳名
            <input required value={form.name} onChange={(event) => updateField("name", event.target.value)} />
          </label>
          <label>
            類型
            <select value={form.category} onChange={(event) => updateField("category", event.target.value)}>
              <option value="vegetarian">素食餐廳</option>
              <option value="mixed">一般餐廳（有素食選擇）</option>
            </select>
          </label>
          <label>
            Google Maps link / 地址
            <input required value={form.address} onChange={(event) => updateField("address", event.target.value)} />
          </label>
        </div>

        <div className="location-actions">
          <button className="secondary-button" type="button" onClick={resolveTypedAddress}>
            <MapPin size={17} />
            讀取地址位置
          </button>
          <button className="secondary-button" type="button" onClick={useCurrentLocation}>
            <LocateFixed size={17} />
            使用目前位置
          </button>
        </div>
        {locationStatus && <p className="ocr-status">{locationStatus}</p>}

        <label>
          備註
          <input value={form.notes} onChange={(event) => updateField("notes", event.target.value)} />
        </label>

        <label className="menu-upload">
          Menu text
          <textarea
            rows="8"
            value={form.menuText}
            onChange={(event) => updateField("menuText", event.target.value)}
            placeholder={"羅漢齋飯 $58\n乾炒牛河 $62\nVegan burger $98"}
          />
        </label>
        {ocrStatus && <p className="ocr-status">{ocrStatus}</p>}

        <div className="modal-actions">
          <label className="secondary-button file-button">
            <Upload size={17} />
            Upload menu image / .txt
            <input accept="image/png,image/jpeg,image/webp,.txt,text/plain" type="file" onChange={(event) => uploadMenu(event.target.files?.[0])} />
          </label>
          <button className="primary-button" type="submit">
            <LocateFixed size={17} />
            加入地圖
          </button>
        </div>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
