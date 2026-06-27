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
  Upload,
  Utensils,
  X,
} from "lucide-react";
import { seedRestaurants } from "./seedRestaurants";
import "./styles.css";

const STORAGE_KEY = "hk-veg-map-restaurants-v3";

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

function App() {
  const [restaurants, setRestaurants] = useState(loadRestaurants);
  const [selectedId, setSelectedId] = useState(restaurants[0]?.id);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
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

  const filteredRestaurants = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return restaurants.filter((restaurant) => {
      const matchesFilter = filter === "all" || restaurant.category === filter;
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
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, restaurants]);

  const selectedRestaurant =
    restaurants.find((restaurant) => restaurant.id === selectedId) || filteredRestaurants[0];

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
          <button className="primary-button" type="button" onClick={() => setShowAdd(true)}>
            <Plus size={18} />
            新餐廳
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar" aria-label="餐廳列表">
          <div className="searchbox">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋餐廳、地區、地址" />
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
            <span>{filteredRestaurants.length} 間餐廳</span>
            <span>
              <Archive size={14} /> local archive
            </span>
          </div>

          <div className="restaurant-list">
            {filteredRestaurants.map((restaurant) => (
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

        <section className="map-region" aria-label="香港餐廳地圖">
          <RestaurantMap
            restaurants={filteredRestaurants}
            selectedRestaurant={selectedRestaurant}
            onSelect={setSelectedId}
          />
        </section>

        <RestaurantDetails restaurant={selectedRestaurant} />
      </main>

      {showAdd && <AddRestaurantModal onClose={() => setShowAdd(false)} onAdd={addRestaurant} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function RestaurantMap({ restaurants, selectedRestaurant, onSelect }) {
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
          html: `<span class="map-marker ${restaurant.category} ${isSelected ? "selected" : ""}">${restaurant.category === "vegetarian" ? "葉" : "素"}</span>`,
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
    lat: "22.3027",
    lng: "114.1772",
    notes: "",
    menuText: "",
  });
  const [ocrStatus, setOcrStatus] = useState("");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
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

  function submit(event) {
    event.preventDefault();
    const menuItems = parseMenuText(form.menuText);
    onAdd({
      id: crypto.randomUUID(),
      name: form.name.trim(),
      category: form.category,
      address: form.address.trim(),
      district: form.district.trim(),
      lat: Number(form.lat),
      lng: Number(form.lng),
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
            <p>填餐廳名、位置，再貼上、upload text 或 menu 圖片。</p>
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
            地址
            <input required value={form.address} onChange={(event) => updateField("address", event.target.value)} />
          </label>
          <label>
            地區
            <input value={form.district} onChange={(event) => updateField("district", event.target.value)} />
          </label>
          <label>
            Latitude
            <input required type="number" step="0.000001" value={form.lat} onChange={(event) => updateField("lat", event.target.value)} />
          </label>
          <label>
            Longitude
            <input required type="number" step="0.000001" value={form.lng} onChange={(event) => updateField("lng", event.target.value)} />
          </label>
        </div>

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
