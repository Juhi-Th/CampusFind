const toggle = document.getElementById("chatbot-toggle");
const closeBtn = document.getElementById("chatbot-close");
const chatWindow = document.getElementById("chatbot-window");
const messages = document.getElementById("chatbot-messages");
const input = document.getElementById("chatbot-input");
const sendBtn = document.getElementById("chatbot-send");

let chatHistory = [];

if (toggle && chatWindow) {
    toggle.addEventListener("click", () => {
        chatWindow.classList.toggle("chatbot-hidden");
        if (!chatWindow.classList.contains("chatbot-hidden")) {
            input?.focus();
            if (messages) messages.scrollTop = messages.scrollHeight;
        }
    });
}

if (closeBtn && chatWindow) {
    closeBtn.addEventListener("click", () => {
        chatWindow.classList.add("chatbot-hidden");
    });
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
}

function formatBotText(rawText) {
    if (!rawText) return "";
    // Sanitize first
    let clean = escapeHtml(rawText);

    // Bold **text**
    clean = clean.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    // Bullet points * item or - item
    clean = clean.replace(/^[*-]\s+(.+)$/gm, "<li>$1</li>");
    clean = clean.replace(/(<li>.*<\/li>)/s, "<ul style='margin: 6px 0 6px 18px; padding: 0;'>$1</ul>");

    // Line breaks
    clean = clean.replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>");

    return clean;
}

function handleChatbotItemClick(item) {
    if (typeof window.openClaimModal === "function") {
        window.openClaimModal(item);
    } else {
        window.location.href = `/home/?item_id=${item.id}`;
    }
}
window.handleChatbotItemClick = handleChatbotItemClick;

function addMessage(text, sender, items = []) {
    const message = document.createElement("div");
    message.className = sender === "user" ? "user-message" : "bot-message";

    if (sender === "bot") {
        message.innerHTML = formatBotText(text);

        // Render matching database item cards if present
        if (Array.isArray(items) && items.length > 0) {
            const container = document.createElement("div");
            container.className = "chatbot-items-container";

            items.forEach(item => {
                const isFound = (item.type || item.item_type) === "found";
                const card = document.createElement("div");
                card.className = "chatbot-item-card";

                const badgeClass = isFound ? "badge-found" : "badge-lost";
                const badgeLabel = isFound ? "FOUND" : "LOST";
                const actionLabel = isFound ? "✨ View & Claim" : "View Report";
                const itemImg = (typeof window.getItemImage === "function")
                    ? window.getItemImage(item)
                    : (item.image_url || "/static/myapp/images/categories/others.jpg");

                card.innerHTML = `
                    <div style="width: 100%; height: 110px; border-radius: 10px; overflow: hidden; position: relative; margin-bottom: 8px; background: #EDE4D8;">
                        <img src="${itemImg}" alt="${escapeHtml(item.name)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.src='/static/myapp/images/categories/others.jpg'">
                        <span class="chatbot-card-badge ${badgeClass}" style="position: absolute; top: 8px; left: 8px;">${badgeLabel}</span>
                    </div>
                    <div class="chatbot-card-header">
                        <div class="chatbot-card-title">${escapeHtml(item.name)}</div>
                    </div>
                    <div class="chatbot-card-meta">
                        <span>📍 ${escapeHtml(item.location || 'Campus')}</span>
                        <span>📁 ${escapeHtml(item.category || 'General')}</span>
                        <span>📅 ${escapeHtml(item.date || '')}</span>
                    </div>
                    ${item.description ? `<div class="chatbot-card-desc">${escapeHtml(item.description)}</div>` : ''}
                    <div class="chatbot-card-actions">
                        <button type="button" class="chatbot-card-btn ${isFound ? 'btn-claim' : ''}" data-item-id="${item.id}">
                            ${actionLabel} &rarr;
                        </button>
                    </div>
                `;

                const btn = card.querySelector(".chatbot-card-btn");
                if (btn) {
                    btn.addEventListener("click", () => handleChatbotItemClick(item));
                }

                container.appendChild(card);
            });

            message.appendChild(container);
        }
    } else {
        message.textContent = text;
    }

    if (messages) {
        messages.appendChild(message);
        messages.scrollTop = messages.scrollHeight;
    }

    return message;
}

function getCSRFToken() {
    const cookie = document.cookie
        .split("; ")
        .find(row => row.startsWith("csrftoken="));

    return cookie ? decodeURIComponent(cookie.split("=")[1]) : "";
}

async function sendMessage() {
    if (!input || !sendBtn) return;
    const message = input.value.trim();

    if (!message || sendBtn.disabled) return;

    addMessage(message, "user");

    input.value = "";
    sendBtn.disabled = true;

    const loading = addMessage("Searching campus records...", "bot");

    try {
        const response = await fetch("/api/chatbot/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": getCSRFToken()
            },
            credentials: "same-origin",
            body: JSON.stringify({
                message: message,
                history: chatHistory
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Something went wrong.");
        }

        loading.remove();
        addMessage(data.reply, "bot", data.items || []);

        chatHistory.push(
            { role: "user", content: message },
            { role: "model", content: data.reply }
        );

        chatHistory = chatHistory.slice(-10);

    } catch (error) {
        if (loading && loading.parentNode) {
            loading.textContent = "⚠️ " + error.message;
            loading.style.color = "#b91c1c";
        } else {
            addMessage("⚠️ " + error.message, "bot");
        }
    } finally {
        sendBtn.disabled = false;
        input.focus();
        if (messages) messages.scrollTop = messages.scrollHeight;
    }
}

if (sendBtn) {
    sendBtn.addEventListener("click", sendMessage);
}

if (input) {
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            sendMessage();
        }
    });
}
