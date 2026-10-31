/**
 * CampusFind - Warm Editorial Lost & Found System
 * Connected to Django views & PostgreSQL database.
 */

let items = [];
let activeType = "all";
let selectedCategory = "";

const API_ITEMS = "/api/items/";
const API_CLAIMS = "/api/claims/";

// DOM elements
const lostTab = document.getElementById("lostTab");
const foundTab = document.getElementById("foundTab");
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const sortOrder = document.getElementById("sortOrder");
const categoryFilter = document.getElementById("categoryFilter");
const locationFilter = document.getElementById("locationFilter");
const searchSubmitBtn = document.getElementById("searchSubmitBtn");
const itemsContainer = document.getElementById("itemsContainer");
const reportForm = document.getElementById("reportForm");
const modalOverlay = document.getElementById("modalOverlay");
const reportButton = document.getElementById("reportButton");
const cancelButton = document.getElementById("cancelButton");
const closeModalBtn = document.getElementById("closeModalBtn");

const lostTabBadge = document.getElementById("lostTabBadge");
const foundTabBadge = document.getElementById("foundTabBadge");
const metricLostCount = document.getElementById("metricLostCount");
const metricFoundCount = document.getElementById("metricFoundCount");

const claimModal = document.getElementById("claimModal");
const closeClaimModalBtn = document.getElementById("closeClaimModalBtn");
const doneClaimModalBtn = document.getElementById("doneClaimModalBtn");
const claimItemBadge = document.getElementById("claimItemBadge");
const claimItemName = document.getElementById("claimItemName");
const claimItemLocation = document.getElementById("claimItemLocation");
const claimContactValue = document.getElementById("claimContactValue");
const copyContactBtn = document.getElementById("copyContactBtn");
const toastContainer = document.getElementById("toastContainer");

const typeRadioLost = document.getElementById("typeRadioLost");
const typeRadioFound = document.getElementById("typeRadioFound");
const itemTypeSelect = document.getElementById("itemType");

// --------------------------------------------------
// CSRF TOKEN
// --------------------------------------------------

function getCookie(name) {
    const cookies = document.cookie ? document.cookie.split(";") : [];

    for (const cookie of cookies) {
        const trimmed = cookie.trim();
        if (trimmed.startsWith(name + "=")) {
            return decodeURIComponent(trimmed.substring(name.length + 1));
        }
    }
    return "";
}

// --------------------------------------------------
// API REQUESTS
// --------------------------------------------------

async function apiRequest(url, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };

    if (options.method && options.method !== "GET") {
        if (!(options.body instanceof FormData)) {
            headers["Content-Type"] = "application/json";
        }
        headers["X-CSRFToken"] = getCookie("csrftoken");
    }

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: "same-origin",
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        if (response.status === 403) {
            throw new Error("Request blocked. Refresh the page and try again.");
        }
        if (response.status === 401 || response.redirected) {
            throw new Error("Your session may have expired. Please log in again.");
        }
        throw new Error(data.error || data.detail || "Something went wrong.");
    }

    return data;
}

// --------------------------------------------------
// UTILITIES
// --------------------------------------------------

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    })[char]);
}

function formatDate(dateString) {
    if (!dateString) return "Recently";
    const parts = dateString.split("-");
    if (parts.length !== 3) return escapeHtml(dateString);
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatRelativeDate(dateString) {
    if (!dateString) return "Recently";
    try {
        const parts = dateString.split("-");
        if (parts.length === 3) {
            const itemDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            itemDate.setHours(0, 0, 0, 0);
            const diffDays = Math.round((now - itemDate) / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) return "Today";
            if (diffDays === 1) return "1 day ago";
            if (diffDays <= 30) return `${diffDays} days ago`;
            return itemDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        }
        return dateString;
    } catch {
        return dateString;
    }
}

// ==================================================
// CENTRALIZED CATEGORY IMAGE SYSTEM
// ==================================================

const CATEGORY_IMAGE_MAP = {
    "electronics": "/static/myapp/images/categories/electronics.jpg",
    "bags & wallets": "/static/myapp/images/categories/bags-wallets.jpg",
    "bags": "/static/myapp/images/categories/bags-wallets.jpg",
    "wallets": "/static/myapp/images/categories/bags-wallets.jpg",
    "books & notes": "/static/myapp/images/categories/books-notes.jpg",
    "books & stationery": "/static/myapp/images/categories/books-notes.jpg",
    "books/notes": "/static/myapp/images/categories/books-notes.jpg",
    "clothing": "/static/myapp/images/categories/clothing.jpg",
    "accessories": "/static/myapp/images/categories/accessories.jpg",
    "personal accessories": "/static/myapp/images/categories/accessories.jpg",
    "keys": "/static/myapp/images/categories/keys.jpg",
    "id cards": "/static/myapp/images/categories/id-cards.jpg",
    "id card": "/static/myapp/images/categories/id-cards.jpg",
    "others": "/static/myapp/images/categories/others.jpg",
    "other": "/static/myapp/images/categories/others.jpg"
};

const DEFAULT_ITEM_IMAGE = "/static/myapp/images/categories/others.jpg";

const BAG_KEYWORDS = [
    "backpack", "bag", "wallet", "purse", "pouch", "handbag",
    "duffel", "duffle", "tote", "briefcase", "satchel", "clutch", "cardholder"
];

const ACCESSORY_KEYWORDS = [
    "bottle", "water bottle", "flask", "watch", "smartwatch",
    "sunglasses", "glasses", "spectacles", "key", "keychain", "ring",
    "umbrella", "cap", "hat", "belt", "gloves", "scarf", "jewelry",
    "bracelet", "necklace", "earring", "claw clip", "scrunchie", "charger"
];

function isBagOrWallet(item) {
    if (!item) return false;
    const cat = (item.category || "").toLowerCase();
    const name = (item.name || "").toLowerCase();
    if (cat.includes("bag") || cat.includes("wallet")) return true;
    return BAG_KEYWORDS.some(kw => name.includes(kw));
}

function isAccessory(item) {
    if (!item) return false;
    if (isBagOrWallet(item)) return false;
    const cat = (item.category || "").toLowerCase();
    const name = (item.name || "").toLowerCase();
    if (cat.includes("accessori") || cat.includes("key")) return true;
    return ACCESSORY_KEYWORDS.some(kw => name.includes(kw));
}

function getItemImage(item) {
    if (!item) return DEFAULT_ITEM_IMAGE;

    // 1. Uploaded photograph takes top priority
    const userImg = item.image_url || item.image || item.photo;
    if (userImg && typeof userImg === "string" && userImg.trim() && !userImg.includes("/static/myapp/images/categories/")) {
        return userImg.trim();
    }

    // 2. Clear distinction between Bags & Wallets vs Accessories
    if (isBagOrWallet(item)) {
        return CATEGORY_IMAGE_MAP["bags & wallets"];
    }
    if (isAccessory(item)) {
        return CATEGORY_IMAGE_MAP["accessories"];
    }

    const cat = (item.category || "").trim().toLowerCase();
    const name = (item.name || "").trim().toLowerCase();

    // 3. Category / Name keyword inference
    if (cat.includes("electronic") || name.includes("phone") || name.includes("laptop") || name.includes("macbook") || name.includes("headphone") || name.includes("earbud") || name.includes("airpod") || name.includes("charger") || name.includes("smartwatch") || name.includes("tablet") || name.includes("ipad")) {
        return CATEGORY_IMAGE_MAP["electronics"];
    }
    if (cat.includes("book") || cat.includes("note") || cat.includes("stationery") || name.includes("book") || name.includes("notebook") || name.includes("textbook") || name.includes("diary") || name.includes("notes") || name.includes("pen") || name.includes("pencil")) {
        return CATEGORY_IMAGE_MAP["books & notes"];
    }
    if (cat.includes("cloth") || name.includes("jacket") || name.includes("shirt") || name.includes("hoodie") || name.includes("sweater") || name.includes("scarf") || name.includes("cap")) {
        return CATEGORY_IMAGE_MAP["clothing"];
    }
    if (cat.includes("card") || name.includes("id card") || name.includes("badge") || name.includes("student id") || name.includes("lanyard")) {
        return CATEGORY_IMAGE_MAP["id cards"];
    }

    if (CATEGORY_IMAGE_MAP[cat]) {
        return CATEGORY_IMAGE_MAP[cat];
    }

    return DEFAULT_ITEM_IMAGE;
}
window.getItemImage = getItemImage;

function showToast(message) {
    if (!toastContainer) {
        alert(message);
        return;
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
}

// --------------------------------------------------
// LOAD ITEMS FROM DJANGO / POSTGRESQL
// --------------------------------------------------

async function loadItems() {
    if (itemsContainer) {
        itemsContainer.innerHTML = "<p class='empty-state'>Loading campus listings from database...</p>";
    }

    try {
        const data = await apiRequest(API_ITEMS);
        items = (data.items || []).map(item => ({
            ...item,
            type: item.item_type,
        }));
        renderItems();
    } catch (error) {
        console.error("Unable to load items:", error);
        if (itemsContainer) {
            itemsContainer.innerHTML = `
                <p class="empty-state">
                    ${escapeHtml(error.message)}<br>
                    Please refresh the page to reload items.
                </p>`;
        }
    }
}

// --------------------------------------------------
// COUNTERS AND ITEM GRID
// --------------------------------------------------

function updateCounters() {
    const lostCount = items.filter(i => i.type === "lost").length;
    const foundCount = items.filter(i => i.type === "found").length;

    if (lostTabBadge) lostTabBadge.textContent = lostCount;
    if (foundTabBadge) foundTabBadge.textContent = foundCount;
    if (metricLostCount) metricLostCount.textContent = lostCount;
    if (metricFoundCount) metricFoundCount.textContent = foundCount;
}

function renderItems() {
    updateCounters();
    if (!itemsContainer) return;

    const keyword = (searchInput?.value || "").trim().toLowerCase();
    const sort = sortOrder?.value || "newest";
    const locValue = (locationFilter?.value || "").trim().toLowerCase();
    const dropdownCat = (categoryFilter?.value || "").trim().toLowerCase();

    if (clearSearchBtn) {
        clearSearchBtn.hidden = !keyword;
    }

    let filtered = items.filter(item => {
        // Match lost/found type if explicitly set to one
        const matchesType = activeType === "all" || item.type === activeType;

        // Match location
        const matchesLocation = !locValue || (item.location || "").toLowerCase().includes(locValue);

        // Match category (either from chips or dropdown)
        let matchesCategory = true;
        const targetCat = (selectedCategory || dropdownCat || "").toLowerCase();

        if (targetCat) {
            const itemCat = (item.category || "").toLowerCase();
            const itemName = (item.name || "").toLowerCase();

            if (targetCat.includes("bag") || targetCat.includes("wallet")) {
                matchesCategory = isBagOrWallet(item);
            } else if (targetCat.includes("accessori")) {
                matchesCategory = isAccessory(item);
            } else if (targetCat.includes("cloth")) {
                matchesCategory = itemCat.includes("cloth") || (!isBagOrWallet(item) && ["jacket", "shirt", "hoodie", "sweater", "pants", "scarf", "coat"].some(kw => itemName.includes(kw)));
            } else if (targetCat.includes("electronic")) {
                matchesCategory = itemCat.includes("electronic") || ["phone", "laptop", "macbook", "headphone", "earbud", "airpod", "charger", "smartwatch", "tablet", "ipad", "powerbank"].some(kw => itemName.includes(kw));
            } else if (targetCat.includes("card")) {
                matchesCategory = itemCat.includes("card") || ["id card", "badge", "student id", "lanyard", "access card"].some(kw => itemName.includes(kw));
            } else if (targetCat.includes("book") || targetCat.includes("stationery")) {
                matchesCategory = itemCat.includes("book") || itemCat.includes("note") || itemCat.includes("stationery") || ["book", "notebook", "textbook", "diary", "notes", "pencil", "pen"].some(kw => itemName.includes(kw));
            } else {
                matchesCategory = itemCat.includes(targetCat) || targetCat.includes(itemCat);
            }
        }

        const searchableText = [
            item.name,
            item.location,
            item.category,
            item.description,
        ].join(" ").toLowerCase();

        return matchesType &&
            matchesCategory &&
            matchesLocation &&
            searchableText.includes(keyword);
    });

    filtered.sort((a, b) => {
        if (sort === "newest") return (b.id || 0) - (a.id || 0);
        if (sort === "oldest") return (a.id || 0) - (b.id || 0);
        if (sort === "alphabetical") return (a.name || "").localeCompare(b.name || "");
        return 0;
    });

    itemsContainer.replaceChildren();

    if (!filtered.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No reported items match your current filter criteria.";
        itemsContainer.appendChild(empty);
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement("article");
        card.className = "editorial-item-card";

        const isLost = item.type === "lost";
        const badgeClass = isLost ? "badge-lost-terracotta" : "badge-found-sage";
        const badgeText = isLost ? "LOST" : "FOUND";
        const itemImgUrl = getItemImage(item);

        let displayCat = item.category || "General";
        if (isBagOrWallet(item)) {
            displayCat = "Bags & Wallets";
        } else if (isAccessory(item)) {
            displayCat = "Accessories";
        }

        card.innerHTML = `
            <div class="card-media-wrap">
                <span class="card-status-badge ${badgeClass}">${badgeText}</span>
                <button type="button" class="btn-card-favorite" aria-label="Favorite item" title="Save item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                </button>
                <img class="card-img" src="${itemImgUrl}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.onerror=null;this.src='${DEFAULT_ITEM_IMAGE}'">
            </div>

            <div class="card-details-body">
                <h3 class="card-item-title">${escapeHtml(item.name)}</h3>

                <div class="card-meta-line">
                    <span class="meta-icon-item" title="${escapeHtml(item.location)}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        <span>${escapeHtml(item.location)}</span>
                    </span>
                    <span class="meta-icon-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>${formatRelativeDate(item.date)}</span>
                    </span>
                </div>

                <div class="card-tag-pills-row">
                    <span class="tag-pill">${escapeHtml(displayCat)}</span>
                    <span class="tag-pill" style="text-transform: capitalize;">${escapeHtml(item.type)}</span>
                </div>
            </div>
        `;

        card.onclick = (e) => {
            // Heart button handler
            const favBtn = e.target.closest(".btn-card-favorite");
            if (favBtn) {
                const heartSvg = favBtn.querySelector("svg");
                const isFavorited = favBtn.classList.toggle("favorited");
                if (isFavorited) {
                    favBtn.style.color = "#c96d45";
                    heartSvg.setAttribute("fill", "#c96d45");
                    showToast(`Saved "${item.name}" to favorites!`);
                } else {
                    favBtn.style.color = "";
                    heartSvg.setAttribute("fill", "none");
                }
                return;
            }
            openClaimModal(item);
        };

        itemsContainer.appendChild(card);
    });
}

// --------------------------------------------------
// ITEM DETAILS / CLAIM MODAL & CONTACT RESOLUTION
// --------------------------------------------------

let selectedClaimItem = null;
const contactActionWrapper = document.getElementById("contactActionWrapper");
const detectedChannelBadge = document.getElementById("detectedChannelBadge");

function normalizePhoneForWhatsApp(rawPhone) {
    if (!rawPhone) return "";
    const cleanDigits = rawPhone.replace(/[^0-9]/g, "");
    if (!cleanDigits) return "";

    // Standard Indian 10-digit mobile starting with 6-9
    if (cleanDigits.length === 10 && /^[6-9]/.test(cleanDigits)) {
        return "91" + cleanDigits;
    }
    // 11 digits starting with 0
    if (cleanDigits.length === 11 && cleanDigits.startsWith("0")) {
        return "91" + cleanDigits.substring(1);
    }
    // Already has country code or non-Indian number
    return cleanDigits;
}

function classifyContact(rawContact) {
    const contact = (rawContact || "").trim();
    if (!contact || contact.toLowerCase().includes("contact protected") || contact.startsWith("PROTECTED:")) {
        return { type: "protected", value: "Contact protected – submit a claim request below." };
    }

    // Email check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(contact)) {
        return { type: "email", value: contact };
    }

    // Phone number check (7-15 digits, no letters)
    const cleanDigits = contact.replace(/[^0-9]/g, "");
    const hasLetters = /[a-zA-Z]/.test(contact);
    if (!hasLetters && cleanDigits.length >= 7 && cleanDigits.length <= 15) {
        return {
            type: "phone",
            value: contact,
            waNumber: normalizePhoneForWhatsApp(contact),
            callNumber: cleanDigits
        };
    }

    // Other plain text note or room number
    return { type: "other", value: contact };
}

function openClaimModal(item) {
    if (!claimModal) return;

    // Resolve full item from local items cache if contact is missing (e.g. from chatbot card)
    if ((!item.contact || item.contact === "undefined") && Array.isArray(items)) {
        const fullItem = items.find(i => String(i.id) === String(item.id));
        if (fullItem && fullItem.contact) {
            item = { ...item, ...fullItem };
        }
    }
    selectedClaimItem = item;

    const isLost = (item.type || item.item_type) === "lost";
    const titleEl = document.getElementById("claimModalTitle");
    if (titleEl) {
        titleEl.textContent = isLost ? "Reported Lost Item" : "Reported Found Item";
    }

    if (claimItemBadge) {
        claimItemBadge.textContent = isLost ? "LOST" : "FOUND";
        claimItemBadge.className = `card-status-badge ${isLost ? "badge-lost-terracotta" : "badge-found-sage"}`;
    }

    if (claimItemName) claimItemName.textContent = item.name || "Item Details";
    if (claimItemLocation) claimItemLocation.textContent = `📍 ${item.location || "Campus"}`;

    const modalMediaImg = document.getElementById("claimItemMediaImg");
    if (modalMediaImg) {
        modalMediaImg.src = getItemImage(item);
        modalMediaImg.alt = item.name || "Item photo";
        modalMediaImg.onerror = () => { modalMediaImg.src = DEFAULT_ITEM_IMAGE; };
    }
    const catBadge = document.getElementById("claimItemCategoryBadge");
    if (catBadge) {
        let displayCat = item.category || "General";
        if (isBagOrWallet(item)) displayCat = "Bags & Wallets";
        else if (isAccessory(item)) displayCat = "Accessories";
        catBadge.textContent = displayCat;
    }

    // Reset claim verification form
    const claimFormSection = document.getElementById("claimFormSection");
    if (claimFormSection) claimFormSection.style.display = "none";
    const claimFormFeedback = document.getElementById("claimFormFeedback");
    if (claimFormFeedback) {
        claimFormFeedback.style.display = "none";
        claimFormFeedback.textContent = "";
    }
    const claimItemId = document.getElementById("claimItemId");
    if (claimItemId) claimItemId.value = item.id || "";

    const deleteBtn = document.getElementById("deleteItemModalBtn");
    if (deleteBtn) {
        deleteBtn.style.display = item.is_owner ? "inline-flex" : "none";
        deleteBtn.onclick = () => deleteItemFromModal(item.id);
    }

    configureContactDisplay(item);
    claimModal.hidden = false;
}
window.openClaimModal = openClaimModal;

function closeClaimModal() {
    if (claimModal) claimModal.hidden = true;
    selectedClaimItem = null;
}

function configureContactDisplay(item) {
    const rawContact = item?.contact || "";
    const itemName = item?.name || "Campus Item";
    const info = classifyContact(rawContact);

    // 1. Update Contact Box & Copy Button
    if (claimContactValue) {
        if (info.type === "protected") {
            claimContactValue.textContent = "Contact protected – submit a claim request below.";
            claimContactValue.style.fontStyle = "italic";
            claimContactValue.style.color = "var(--text-secondary)";
            claimContactValue.style.background = "rgba(232, 222, 209, 0.4)";
            if (copyContactBtn) copyContactBtn.style.display = "none";
            if (detectedChannelBadge) detectedChannelBadge.textContent = "🔒 Protected Contact";
        } else {
            claimContactValue.textContent = info.value;
            claimContactValue.style.fontStyle = "normal";
            claimContactValue.style.color = "#342638";
            claimContactValue.style.background = "#ffffff";
            if (copyContactBtn) copyContactBtn.style.display = "inline-block";

            if (detectedChannelBadge) {
                if (info.type === "phone") detectedChannelBadge.textContent = "💬 WhatsApp Ready";
                else if (info.type === "email") detectedChannelBadge.textContent = "📧 Verified Email";
                else detectedChannelBadge.textContent = "📝 Contact Note";
            }
        }
    }

    // 2. Render Action Buttons
    const wrapper = document.getElementById("contactActionWrapper");
    if (!wrapper) return;

    if (info.type === "phone") {
        const encodedMsg = encodeURIComponent(`Hi, I'm contacting you regarding your CampusFind listing: "${itemName}".`);
        wrapper.innerHTML = `
            <div class="contact-action-row">
                <a href="https://wa.me/${info.waNumber}?text=${encodedMsg}" target="_blank" rel="noopener noreferrer" class="btn-contact-us btn-contact-whatsapp">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.004c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    <span>Chat on WhatsApp</span>
                </a>
                <a href="tel:${info.callNumber}" class="btn-contact-us btn-contact-call">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                    </svg>
                    <span>Call Reporter</span>
                </a>
            </div>
            <button type="button" id="btnToggleClaimSection" style="background: none; border: none; font-size: 0.8rem; font-weight: 600; color: var(--color-copper); cursor: pointer; text-decoration: underline; margin-top: 6px; padding: 4px;">
                Need official handover? Submit claim verification &rarr;
            </button>
        `;
    } else if (info.type === "email") {
        const subject = encodeURIComponent(`CampusFind Inquiry: ${itemName}`);
        const body = encodeURIComponent(`Hi, I am contacting you regarding your CampusFind report for "${itemName}".`);
        wrapper.innerHTML = `
            <a href="mailto:${info.value}?subject=${subject}&body=${body}" class="btn-contact-us btn-contact-email">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
                <span>Send Email to Reporter</span>
            </a>
            <button type="button" id="btnToggleClaimSection" style="background: none; border: none; font-size: 0.8rem; font-weight: 600; color: var(--color-copper); cursor: pointer; text-decoration: underline; margin-top: 6px; padding: 4px;">
                Need official handover? Submit claim verification &rarr;
            </button>
        `;
    } else if (info.type === "protected") {
        wrapper.innerHTML = `
            <button type="button" id="btnOpenClaimForm" class="btn-contact-us btn-contact-claim">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
                <span>Submit Verification Claim</span>
            </button>
        `;
        // Auto-show claim form for protected contacts so student can immediately claim
        const claimFormSection = document.getElementById("claimFormSection");
        if (claimFormSection) claimFormSection.style.display = "block";
    } else {
        wrapper.innerHTML = `
            <button type="button" id="btnOpenClaimForm" class="btn-contact-us btn-contact-claim">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <span>Submit Claim / Message</span>
            </button>
        `;
    }

    // Attach listeners for opening claim section
    const btnToggle = document.getElementById("btnToggleClaimSection");
    if (btnToggle) {
        btnToggle.onclick = () => {
            const formSec = document.getElementById("claimFormSection");
            if (formSec) {
                formSec.style.display = formSec.style.display === "none" ? "block" : "none";
                if (formSec.style.display === "block") {
                    formSec.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }
            }
        };
    }

    const btnOpen = document.getElementById("btnOpenClaimForm");
    if (btnOpen) {
        btnOpen.onclick = () => {
            const formSec = document.getElementById("claimFormSection");
            if (formSec) {
                formSec.style.display = "block";
                formSec.scrollIntoView({ behavior: "smooth", block: "nearest" });
                const claimantMsg = document.getElementById("claimantMessage");
                if (claimantMsg) claimantMsg.focus();
            }
        };
    }
}

// Backward compatibility alias
function configureContactButton(rawContact) {
    configureContactDisplay(selectedClaimItem || { contact: rawContact });
}

async function deleteItemFromModal(itemId) {
    if (!confirm("Are you sure you want to permanently delete this report?")) return;

    try {
        await apiRequest(`/api/items/${itemId}/delete/`, { method: "POST" });
        showToast("Report deleted successfully.");
        closeClaimModal();
        await loadItems();
    } catch (error) {
        showToast(error.message || "Failed to delete report.");
    }
}

if (closeClaimModalBtn) closeClaimModalBtn.onclick = closeClaimModal;
if (doneClaimModalBtn) doneClaimModalBtn.onclick = closeClaimModal;

const toggleClaimFormBtn = document.getElementById("toggleClaimFormBtn");
if (toggleClaimFormBtn) {
    toggleClaimFormBtn.onclick = () => {
        const claimFormSection = document.getElementById("claimFormSection");
        if (claimFormSection) claimFormSection.style.display = "none";
    };
}

// Claim form submit listener
const itemClaimForm = document.getElementById("itemClaimForm");
if (itemClaimForm) {
    itemClaimForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById("submitClaimBtn");
        const feedbackEl = document.getElementById("claimFormFeedback");
        if (submitBtn) submitBtn.disabled = true;

        const payload = {
            item_id: selectedClaimItem?.id || document.getElementById("claimItemId")?.value,
            claimant_name: document.getElementById("claimantName")?.value.trim() || "",
            claimant_contact: document.getElementById("claimantContact")?.value.trim() || "",
            message: document.getElementById("claimantMessage")?.value.trim() || ""
        };

        try {
            const res = await apiRequest("/api/claims/", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            if (feedbackEl) {
                feedbackEl.style.display = "block";
                feedbackEl.style.background = "rgba(156, 203, 135, 0.2)";
                feedbackEl.style.color = "#27672a";
                feedbackEl.style.border = "1px solid #9CCB87";
                feedbackEl.textContent = res.message || "Claim verification submitted successfully!";
            }
            showToast("Claim verification request submitted!");
            itemClaimForm.reset();
            setTimeout(() => {
                const claimFormSection = document.getElementById("claimFormSection");
                if (claimFormSection) claimFormSection.style.display = "none";
            }, 2500);
        } catch (err) {
            if (feedbackEl) {
                feedbackEl.style.display = "block";
                feedbackEl.style.background = "rgba(201, 109, 69, 0.15)";
                feedbackEl.style.color = "#C96D45";
                feedbackEl.style.border = "1px solid #C96D45";
                feedbackEl.textContent = err.message || "Could not submit claim. Please check your details.";
            }
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}

if (copyContactBtn) {
    copyContactBtn.onclick = async () => {
        const info = classifyContact(selectedClaimItem?.contact);
        if (info.type === "protected") {
            showToast("Contact details are protected.");
            return;
        }
        const text = info.value || claimContactValue?.textContent || "";
        try {
            await navigator.clipboard.writeText(text);
            showToast("Contact copied to clipboard!");
        } catch {
            showToast(`Contact: ${text}`);
        }
    };
}

// --------------------------------------------------
// SEARCH & FILTERS
// --------------------------------------------------

if (searchInput) searchInput.addEventListener("input", renderItems);
if (categoryFilter) categoryFilter.addEventListener("change", renderItems);
if (locationFilter) locationFilter.addEventListener("change", renderItems);
if (sortOrder) sortOrder.addEventListener("change", renderItems);
if (searchSubmitBtn) searchSubmitBtn.addEventListener("click", renderItems);

if (clearSearchBtn) {
    clearSearchBtn.onclick = () => {
        if (searchInput) {
            searchInput.value = "";
            searchInput.focus();
        }
        renderItems();
    };
}

document.querySelectorAll(".category-chip").forEach(chip => {
    chip.onclick = () => {
        document.querySelectorAll(".category-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        selectedCategory = chip.dataset.category || "";
        if (categoryFilter) categoryFilter.value = "";
        renderItems();
    };
});

// View All Items Link in Header
const viewAllLink = document.getElementById("viewAllLink");
if (viewAllLink) {
    viewAllLink.onclick = (e) => {
        e.preventDefault();
        selectedCategory = "";
        if (categoryFilter) categoryFilter.value = "";
        if (locationFilter) locationFilter.value = "";
        if (searchInput) searchInput.value = "";
        document.querySelectorAll(".category-chip").forEach(c => c.classList.remove("active"));
        document.querySelector('.category-chip[data-category=""]')?.classList.add("active");
        renderItems();
        document.getElementById("community-board")?.scrollIntoView({ behavior: "smooth" });
    };
}

// Nav Search Trigger Button
const navSearchTrigger = document.getElementById("navSearchTrigger");
if (navSearchTrigger) {
    navSearchTrigger.onclick = () => {
        document.getElementById("search-section")?.scrollIntoView({ behavior: "smooth" });
        setTimeout(() => searchInput?.focus(), 300);
    };
}

// --------------------------------------------------
// REPORT ITEM MODAL
// --------------------------------------------------

function openReportModal() {
    if (!modalOverlay) return;
    modalOverlay.hidden = false;

    if (typeRadioFound) typeRadioFound.checked = false;
    if (typeRadioLost) typeRadioLost.checked = true;
    if (itemTypeSelect) itemTypeSelect.value = "lost";

    const dateInput = document.getElementById("itemDate");
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split("T")[0];
    }
    document.getElementById("itemName")?.focus();
}

function closeReportModal() {
    reportForm?.reset();
    removeSelectedPhoto();
    if (modalOverlay) modalOverlay.hidden = true;
}

// --------------------------------------------------
// REPORT ITEM PHOTO UPLOAD HANDLER
// --------------------------------------------------

let selectedReportPhotoFile = null;

const photoDropzone = document.getElementById("photoDropzone");
const itemPhotoInput = document.getElementById("itemPhotoInput");
const photoPreviewContainer = document.getElementById("photoPreviewContainer");
const photoPreviewImg = document.getElementById("photoPreviewImg");
const photoPreviewName = document.getElementById("photoPreviewName");
const photoPreviewDimensions = document.getElementById("photoPreviewDimensions");
const photoChangeBtn = document.getElementById("photoChangeBtn");
const photoRemoveBtn = document.getElementById("photoRemoveBtn");
const photoValidationError = document.getElementById("photoValidationError");
const photoValidationMsg = document.getElementById("photoValidationMsg");

function showPhotoError(msg) {
    if (!photoValidationError || !photoValidationMsg) return;
    photoValidationMsg.textContent = msg;
    photoValidationError.style.display = "flex";
}

function clearPhotoError() {
    if (!photoValidationError) return;
    photoValidationError.style.display = "none";
}

function handlePhotoSelection(file) {
    clearPhotoError();
    if (!file) return;

    // Validate size (max 5 MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
        showPhotoError("File size exceeds 5 MB limit. Please select a smaller photo.");
        return;
    }

    // Validate extension / mime
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    const validExts = [".jpg", ".jpeg", ".png", ".webp"];
    if (!validTypes.includes(file.type) && !validExts.includes(ext)) {
        showPhotoError("Invalid image format. Allowed formats: JPG, JPEG, PNG, WEBP.");
        return;
    }

    selectedReportPhotoFile = file;

    // Preview image
    const reader = new FileReader();
    reader.onload = (e) => {
        if (photoPreviewImg) photoPreviewImg.src = e.target.result;
        if (photoPreviewName) photoPreviewName.textContent = file.name;
        if (photoPreviewDimensions) {
            const sizeKb = (file.size / 1024).toFixed(1);
            photoPreviewDimensions.textContent = sizeKb >= 1000 ? `${(sizeKb / 1024).toFixed(2)} MB` : `${sizeKb} KB`;
        }
        if (photoDropzone) photoDropzone.style.display = "none";
        if (photoPreviewContainer) photoPreviewContainer.style.display = "block";
    };
    reader.readAsDataURL(file);
}

function removeSelectedPhoto() {
    selectedReportPhotoFile = null;
    if (itemPhotoInput) itemPhotoInput.value = "";
    if (photoPreviewImg) photoPreviewImg.src = "";
    if (photoPreviewContainer) photoPreviewContainer.style.display = "none";
    if (photoDropzone) photoDropzone.style.display = "flex";
    clearPhotoError();
}

if (photoDropzone && itemPhotoInput) {
    photoDropzone.addEventListener("click", () => itemPhotoInput.click());
    photoDropzone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            itemPhotoInput.click();
        }
    });

    // Drag & Drop
    photoDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        photoDropzone.classList.add("dragover");
    });
    photoDropzone.addEventListener("dragleave", () => {
        photoDropzone.classList.remove("dragover");
    });
    photoDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        photoDropzone.classList.remove("dragover");
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            handlePhotoSelection(files[0]);
        }
    });

    itemPhotoInput.addEventListener("change", () => {
        if (itemPhotoInput.files && itemPhotoInput.files.length > 0) {
            handlePhotoSelection(itemPhotoInput.files[0]);
        }
    });
}

if (photoChangeBtn && itemPhotoInput) {
    photoChangeBtn.addEventListener("click", () => itemPhotoInput.click());
}

if (photoRemoveBtn) {
    photoRemoveBtn.addEventListener("click", removeSelectedPhoto);
}

if (reportButton) reportButton.onclick = openReportModal;
if (cancelButton) cancelButton.onclick = closeReportModal;
if (closeModalBtn) closeModalBtn.onclick = closeReportModal;

const navReportLink = document.getElementById("navReportLink");
if (navReportLink) navReportLink.onclick = (e) => { e.preventDefault(); openReportModal(); };

const aboutReportBtn = document.getElementById("aboutReportBtn");
if (aboutReportBtn) aboutReportBtn.onclick = (e) => { e.preventDefault(); openReportModal(); };

if (typeRadioLost && itemTypeSelect) {
    typeRadioLost.addEventListener("change", () => {
        if (typeRadioLost.checked) itemTypeSelect.value = "lost";
    });
}

if (typeRadioFound && itemTypeSelect) {
    typeRadioFound.addEventListener("change", () => {
        if (typeRadioFound.checked) itemTypeSelect.value = "found";
    });
}

window.addEventListener("click", event => {
    if (event.target === modalOverlay) closeReportModal();
    if (event.target === claimModal) closeClaimModal();
});

window.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeReportModal();
        closeClaimModal();
    }
});

// --------------------------------------------------
// SUBMIT REPORT TO DJANGO / POSTGRESQL
// --------------------------------------------------

if (reportForm) {
    reportForm.addEventListener("submit", async event => {
        event.preventDefault();

        const submitButton = reportForm.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;

        const selectedType = typeRadioFound?.checked || itemTypeSelect?.value === "found" ? "found" : "lost";
        const descriptionElement = document.getElementById("itemDescription");

        const isShareContact = document.getElementById("itemShareContact") ? document.getElementById("itemShareContact").checked : true;
        
        const formData = new FormData();
        formData.append("name", document.getElementById("itemName")?.value.trim() || "");
        formData.append("item_type", selectedType);
        formData.append("category", document.getElementById("itemCategory")?.value || "");
        formData.append("location", document.getElementById("itemLocation")?.value.trim() || "");
        formData.append("date", document.getElementById("itemDate")?.value || "");
        formData.append("contact", document.getElementById("itemContact")?.value.trim() || "");
        formData.append("share_contact", isShareContact);
        formData.append("description", descriptionElement?.value.trim() || "");

        if (selectedReportPhotoFile) {
            formData.append("image", selectedReportPhotoFile);
        }

        try {
            const result = await apiRequest(API_ITEMS, {
                method: "POST",
                body: formData,
            });

            showToast(result.message || "Item reported successfully!");
            closeReportModal();
            await loadItems();
        } catch (error) {
            console.error("Report submission failed:", error);
            showToast(error.message || "Unable to submit the report.");
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
}

// --------------------------------------------------
// THEME INITIALIZATION
// --------------------------------------------------

function initTheme() {
    const savedTheme = localStorage.getItem("campusfind_theme");
    const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = savedTheme || (systemDark ? "dark" : "light");
    applyTheme(initialTheme, false);

    const themeToggleBtn = document.getElementById("themeToggleBtn");
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", () => {
            const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
            const newTheme = currentTheme === "dark" ? "light" : "dark";
            applyTheme(newTheme, true);
        });
    }
}

function applyTheme(theme, showNotification = false) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("campusfind_theme", theme);
}

// --------------------------------------------------
// NOTIFICATION SYSTEM
// --------------------------------------------------

const navNotificationWrapper = document.getElementById("navNotificationWrapper");
const navNotificationBtn = document.getElementById("navNotificationBtn");
const navNotificationBadge = document.getElementById("navNotificationBadge");
const notificationPanel = document.getElementById("notificationPanel");
const notifUnreadPill = document.getElementById("notifUnreadPill");
const notifMarkAllReadBtn = document.getElementById("notifMarkAllReadBtn");
const notifCloseBtn = document.getElementById("notifCloseBtn");
const notifPanelBody = document.getElementById("notifPanelBody");
const notifLoadingState = document.getElementById("notifLoadingState");
const notifList = document.getElementById("notifList");
const notifEmptyState = document.getElementById("notifEmptyState");
const notifErrorState = document.getElementById("notifErrorState");
const notifErrorSubtitle = document.getElementById("notifErrorSubtitle");
const notifRetryBtn = document.getElementById("notifRetryBtn");

// Explicit popup state - default is strictly closed
let isNotificationOpen = false;
let notificationsData = [];
let unreadNotifCount = 0;
let notifPollingInterval = null;
let notifAbortController = null;

function formatNotifTime(isoString) {
    if (!isoString) return "";
    try {
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHr = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHr / 24);

        if (diffSec < 60) return "Just now";
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHr < 24) return `${diffHr}h ago`;
        if (diffDay === 1) return "Yesterday";
        if (diffDay < 7) return `${diffDay}d ago`;

        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
        return "";
    }
}

function getNotifIconHtml(type) {
    switch (type) {
        case "new_item":
            return `<div class="notif-icon-circle notif-icon-new_item">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
            </div>`;
        case "new_claim":
            return `<div class="notif-icon-circle notif-icon-new_claim">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            </div>`;
        case "claim_approved":
            return `<div class="notif-icon-circle notif-icon-claim_approved">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
            </div>`;
        case "claim_rejected":
            return `<div class="notif-icon-circle notif-icon-claim_rejected">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
            </div>`;
        case "item_removed":
            return `<div class="notif-icon-circle notif-icon-item_removed">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </div>`;
        default:
            return `<div class="notif-icon-circle notif-icon-system">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
            </div>`;
    }
}

function updateBadgeDisplay(count) {
    unreadNotifCount = count;
    if (navNotificationBadge) {
        navNotificationBadge.style.display = count > 0 ? "block" : "none";
    }
    if (notifUnreadPill) {
        notifUnreadPill.textContent = count > 0 ? `${count} new` : "0 new";
    }
}

async function fetchUnreadCount() {
    try {
        const response = await fetch("/api/notifications/unread-count/", {
            headers: {
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest"
            }
        });
        if (!response.ok) return;
        const data = await response.json();
        updateBadgeDisplay(data.unread_count || 0);
    } catch {
        // Silently skip if network error during background polling
    }
}

async function fetchNotifications() {
    if (!notifLoadingState || !notifList || !notifEmptyState) return;

    // Cancel previous in-flight request if still running
    if (notifAbortController) {
        notifAbortController.abort();
    }
    notifAbortController = new AbortController();

    // Reset UI states
    notifLoadingState.style.display = "flex";
    notifList.innerHTML = "";
    notifEmptyState.style.display = "none";
    if (notifErrorState) notifErrorState.style.display = "none";

    // 8-second safety timeout so it cannot hang forever
    const timeoutId = setTimeout(() => {
        if (notifAbortController) {
            notifAbortController.abort();
        }
    }, 8000);

    try {
        const response = await fetch("/api/notifications/", {
            headers: {
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest"
            },
            signal: notifAbortController.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();
        notificationsData = data.notifications || [];
        updateBadgeDisplay(data.unread_count || 0);

        if (notificationsData.length === 0) {
            notifEmptyState.style.display = "flex";
        } else {
            renderNotificationList(notificationsData);
        }
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
            console.warn("Notification fetch timed out or was cancelled.");
        } else {
            console.error("Failed to load notifications:", err);
        }

        // Show error state with retry button
        if (notifErrorState) {
            notifErrorState.style.display = "flex";
            if (notifErrorSubtitle) {
                notifErrorSubtitle.textContent = (err.name === "AbortError")
                    ? "Request timed out. Please check your connection and retry."
                    : "Unable to load notifications. Please try again.";
            }
        }
    } finally {
        notifAbortController = null;
        // The loading state MUST ALWAYS end, whether the request succeeds or fails
        notifLoadingState.style.display = "none";
    }
}

function renderNotificationList(items) {
    if (!notifList) return;
    notifList.innerHTML = "";

    items.forEach((notif) => {
        const itemEl = document.createElement("div");
        itemEl.className = `notif-item ${notif.is_read ? "" : "notif-unread"}`;
        itemEl.dataset.id = notif.id;

        const iconHtml = getNotifIconHtml(notif.type);
        const timeFormatted = formatNotifTime(notif.created_at);

        itemEl.innerHTML = `
            ${iconHtml}
            <div class="notif-content-wrap">
                <div class="notif-item-title">${escapeNotifHtml(notif.title)}</div>
                <div class="notif-item-msg">${escapeNotifHtml(notif.message)}</div>
                <div class="notif-item-time">${timeFormatted}</div>
            </div>
        `;

        itemEl.addEventListener("click", () => handleNotificationClick(notif, itemEl));
        notifList.appendChild(itemEl);
    });
}

function escapeNotifHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function handleNotificationClick(notif, element) {
    // Mark as read on server if unread
    if (!notif.is_read) {
        notif.is_read = true;
        element.classList.remove("notif-unread");
        updateBadgeDisplay(Math.max(0, unreadNotifCount - 1));

        try {
            await fetch(`/api/notifications/${notif.id}/read/`, {
                method: "POST",
                headers: {
                    "X-CSRFToken": getCookie("csrftoken"),
                    "Accept": "application/json"
                }
            });
        } catch (e) {
            console.error("Failed to mark notification read:", e);
        }
    }

    // Navigate to target_url if present
    if (notif.target_url) {
        closeNotificationPanel();
        if (notif.target_url.startsWith("#")) {
            const targetEl = document.querySelector(notif.target_url);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: "smooth" });
            }
            if (notif.item_id) {
                const matchedItem = (allReportedItems || []).find(i => String(i.id) === String(notif.item_id));
                if (matchedItem && typeof openClaimModal === "function") {
                    openClaimModal(matchedItem);
                }
            }
        } else {
            window.location.href = notif.target_url;
        }
    }
}

async function markAllNotificationsRead() {
    if (unreadNotifCount === 0) return;

    // Immediately update UI
    updateBadgeDisplay(0);
    const unreadElements = notifList ? notifList.querySelectorAll(".notif-unread") : [];
    unreadElements.forEach(el => el.classList.remove("notif-unread"));
    notificationsData.forEach(n => n.is_read = true);

    try {
        await fetch("/api/notifications/mark-all-read/", {
            method: "POST",
            headers: {
                "X-CSRFToken": getCookie("csrftoken"),
                "Accept": "application/json"
            }
        });
    } catch (e) {
        console.error("Failed to mark all as read:", e);
    }
}

function openNotificationPanel() {
    if (!notificationPanel) return;
    isNotificationOpen = true;
    notificationPanel.hidden = false;
    notificationPanel.style.display = "flex";
    notificationPanel.classList.add("active");
    navNotificationBtn?.setAttribute("aria-expanded", "true");
    fetchNotifications();
}

function closeNotificationPanel() {
    if (!notificationPanel) return;
    isNotificationOpen = false;
    notificationPanel.hidden = true;
    notificationPanel.style.display = "none";
    notificationPanel.classList.remove("active");
    navNotificationBtn?.setAttribute("aria-expanded", "false");

    if (notifAbortController) {
        notifAbortController.abort();
        notifAbortController = null;
    }
}

function toggleNotificationPanel(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (!notificationPanel) return;
    if (isNotificationOpen) {
        closeNotificationPanel();
    } else {
        openNotificationPanel();
    }
}

function initNotificationSystem() {
    // 1. Strictly enforce hidden state on initial load
    closeNotificationPanel();

    // 2. Bell toggle
    if (navNotificationBtn) {
        navNotificationBtn.addEventListener("click", toggleNotificationPanel);
    }

    // 3. Close button (X)
    if (notifCloseBtn) {
        notifCloseBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            closeNotificationPanel();
        });
    }

    // 4. Retry button
    if (notifRetryBtn) {
        notifRetryBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            fetchNotifications();
        });
    }

    // 5. Mark all as read
    if (notifMarkAllReadBtn) {
        notifMarkAllReadBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            markAllNotificationsRead();
        });
    }

    // 6. Close panel on clicks anywhere outside
    document.addEventListener("click", (e) => {
        if (!isNotificationOpen) return;
        if (!navNotificationWrapper?.contains(e.target)) {
            closeNotificationPanel();
        }
    });

    // 7. Close on Escape key
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && isNotificationOpen) {
            closeNotificationPanel();
        }
    });

    // 8. Stop polling when page is unloaded
    window.addEventListener("beforeunload", () => {
        if (notifPollingInterval) {
            clearInterval(notifPollingInterval);
            notifPollingInterval = null;
        }
    });

    // 9. Initial background unread count fetch (does NOT display popup)
    fetchUnreadCount();

    // 10. Start polling interval (single instance)
    if (notifPollingInterval) {
        clearInterval(notifPollingInterval);
    }
    notifPollingInterval = setInterval(fetchUnreadCount, 25000);
}

// Start
initTheme();
loadItems();
initNotificationSystem();
