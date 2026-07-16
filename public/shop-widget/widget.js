/**
 * キープオンショップ AI商品検索チャットウィジェット
 * 設置: <script src="https://{vercelドメイン}/shop-widget/widget.js" defer></script>
 * 素のJS単体で完結（ビルド不要）。既存ページのCSSと衝突しないよう全クラスに kpw- を付与。
 */
(function () {
  "use strict";

  var API_ENDPOINT = (function () {
    var current = document.currentScript;
    if (current && current.src) {
      try {
        return new URL("/api/shop-chat", current.src).toString();
      } catch {
        // fallthrough
      }
    }
    return "/api/shop-chat";
  })();

  var SESSION_KEY = "kpw-chat-history";
  var MAX_MESSAGE_LENGTH = 500;
  var MAX_HISTORY_TURNS = 5;

  var GREETING =
    "こんにちは！キープオンショップのAIアシスタントです。\n" +
    "『サテン素材のハッピ』のように、話すように入力してみてください🎈";

  // ---------- スタイル注入 ----------
  var style = document.createElement("style");
  style.textContent = [
    ".kpw-root { --kpw-accent: #e8492f; all: initial; }",
    ".kpw-root, .kpw-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif; }",
    ".kpw-launcher { position: fixed; bottom: 100px; right: 20px; z-index: 2147482900; display: flex; align-items: center; }",
    ".kpw-launcher-label { background: #fff; color: #333; padding: 6px 12px; border-radius: 16px; margin-right: 8px; font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,.15); white-space: nowrap; opacity: 0; transform: translateX(8px); transition: opacity .2s ease, transform .2s ease; pointer-events: none; }",
    ".kpw-launcher:hover .kpw-launcher-label, .kpw-launcher-label.kpw-show { opacity: 1; transform: translateX(0); }",
    ".kpw-button { width: 56px; height: 56px; border-radius: 50%; background: var(--kpw-accent); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,.25); transition: transform .15s ease; }",
    ".kpw-button:hover { transform: scale(1.05); }",
    ".kpw-button svg { width: 28px; height: 28px; }",
    ".kpw-panel { position: fixed; bottom: 168px; right: 20px; width: 360px; height: 520px; max-height: 75vh; background: #fff; border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.25); z-index: 2147482900; display: none; flex-direction: column; overflow: hidden; }",
    ".kpw-panel.kpw-open { display: flex; }",
    ".kpw-header { background: var(--kpw-accent); color: #fff; padding: 12px 16px; flex-shrink: 0; }",
    ".kpw-header-title { font-size: 15px; font-weight: bold; margin: 0; }",
    ".kpw-header-sub { font-size: 11px; opacity: .9; margin: 2px 0 0; }",
    ".kpw-close { position: absolute; top: 10px; right: 12px; background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; line-height: 1; }",
    ".kpw-body { flex: 1; overflow-y: auto; padding: 12px; background: #f7f5f2; display: flex; flex-direction: column; gap: 10px; }",
    ".kpw-msg { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }",
    ".kpw-msg-assistant { background: #fff; color: #333; align-self: flex-start; border-bottom-left-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }",
    ".kpw-msg-user { background: var(--kpw-accent); color: #fff; align-self: flex-end; border-bottom-right-radius: 2px; }",
    ".kpw-msg-error { background: #fde8e8; color: #b02a2a; align-self: flex-start; }",
    ".kpw-typing { align-self: flex-start; background: #fff; border-radius: 12px; padding: 8px 14px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }",
    ".kpw-typing span { display: inline-block; width: 6px; height: 6px; margin: 0 1px; border-radius: 50%; background: #bbb; animation: kpw-bounce 1.2s infinite ease-in-out; }",
    ".kpw-typing span:nth-child(2) { animation-delay: .15s; }",
    ".kpw-typing span:nth-child(3) { animation-delay: .3s; }",
    "@keyframes kpw-bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }",
    ".kpw-products { display: flex; flex-direction: column; gap: 8px; align-self: stretch; }",
    ".kpw-card { display: flex; gap: 8px; background: #fff; border-radius: 10px; padding: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.1); text-decoration: none; color: inherit; }",
    ".kpw-card-img { width: 56px; height: 56px; border-radius: 6px; object-fit: cover; flex-shrink: 0; background: #eee; }",
    ".kpw-card-info { display: flex; flex-direction: column; justify-content: center; min-width: 0; }",
    ".kpw-card-name { font-size: 12px; color: #333; margin: 0 0 4px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }",
    ".kpw-card-price { font-size: 13px; font-weight: bold; color: var(--kpw-accent); margin: 0 0 2px; }",
    ".kpw-card-link { font-size: 11px; color: #666; text-decoration: underline; }",
    ".kpw-footer { border-top: 1px solid #eee; padding: 8px; display: flex; gap: 8px; flex-shrink: 0; background: #fff; }",
    ".kpw-input { flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 8px 14px; font-size: 13px; outline: none; resize: none; }",
    ".kpw-input:focus { border-color: var(--kpw-accent); }",
    ".kpw-send { background: var(--kpw-accent); border: none; color: #fff; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }",
    ".kpw-send:disabled { opacity: .5; cursor: default; }",
    "@media (max-width: 420px) {",
    "  .kpw-panel { width: calc(100vw - 24px); right: 12px; left: 12px; height: 75vh; bottom: 168px; }",
    "  .kpw-launcher { right: 12px; }",
    "}",
  ].join("\n");
  document.head.appendChild(style);

  // ---------- ルート要素 ----------
  var root = document.createElement("div");
  root.className = "kpw-root";
  document.body.appendChild(root);

  var launcher = document.createElement("div");
  launcher.className = "kpw-launcher";
  launcher.innerHTML =
    '<span class="kpw-launcher-label">AIで商品をさがす</span>' +
    '<button class="kpw-button" type="button" aria-label="AIで商品をさがす">' +
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="10.5" cy="10.5" r="6.5" stroke="#fff" stroke-width="2"/>' +
    '<line x1="15.2" y1="15.2" x2="20" y2="20" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M9 9c1.2-1.2 2.8-1.2 4 0" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>' +
    "</svg>" +
    "</button>";
  root.appendChild(launcher);

  var panel = document.createElement("div");
  panel.className = "kpw-panel";
  panel.innerHTML =
    '<div class="kpw-header">' +
    '<button class="kpw-close" type="button" aria-label="閉じる">&times;</button>' +
    '<p class="kpw-header-title">AI商品さがしアシスタント（β）</p>' +
    '<p class="kpw-header-sub">※商品探し専用のチャットです</p>' +
    "</div>" +
    '<div class="kpw-body" role="log"></div>' +
    '<div class="kpw-footer">' +
    '<textarea class="kpw-input" rows="1" maxlength="' +
    MAX_MESSAGE_LENGTH +
    '" placeholder="例）サテン素材のハッピ"></textarea>' +
    '<button class="kpw-send" type="button" aria-label="送信">' +
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12L20 4L13 20L11 13L4 12Z" fill="#fff"/></svg>' +
    "</button>" +
    "</div>";
  root.appendChild(panel);

  var launcherLabel = launcher.querySelector(".kpw-launcher-label");
  var launcherButton = launcher.querySelector(".kpw-button");
  var closeButton = panel.querySelector(".kpw-close");
  var body = panel.querySelector(".kpw-body");
  var input = panel.querySelector(".kpw-input");
  var sendButton = panel.querySelector(".kpw-send");

  // 初回だけラベルを少し目立たせる
  setTimeout(function () {
    launcherLabel.classList.add("kpw-show");
    setTimeout(function () {
      launcherLabel.classList.remove("kpw-show");
    }, 4000);
  }, 1500);

  // ---------- 履歴の保存/復元 ----------
  function loadHistory() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(history.slice(-MAX_HISTORY_TURNS * 2)));
    } catch {
      // sessionStorageが使えない場合は無視
    }
  }

  var history = loadHistory();

  function appendMessage(role, text) {
    var msg = document.createElement("div");
    msg.className = "kpw-msg kpw-msg-" + role;
    msg.textContent = text;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
    return msg;
  }

  function appendError(text) {
    var msg = document.createElement("div");
    msg.className = "kpw-msg kpw-msg-error";
    msg.textContent = text;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
  }

  function appendProducts(products) {
    if (!products || products.length === 0) return;
    var wrap = document.createElement("div");
    wrap.className = "kpw-products";
    products.forEach(function (p) {
      var card = document.createElement("a");
      card.className = "kpw-card";
      card.href = p.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";

      var img = document.createElement("img");
      img.className = "kpw-card-img";
      img.src = p.image_url || "";
      img.alt = p.name || "";
      img.loading = "lazy";

      var info = document.createElement("div");
      info.className = "kpw-card-info";

      var name = document.createElement("p");
      name.className = "kpw-card-name";
      name.textContent = p.name || "";

      var price = document.createElement("p");
      price.className = "kpw-card-price";
      price.textContent = typeof p.price === "number" ? "¥" + p.price.toLocaleString() + "（税込）" : "";

      var link = document.createElement("span");
      link.className = "kpw-card-link";
      link.textContent = "商品ページへ";

      info.appendChild(name);
      info.appendChild(price);
      info.appendChild(link);
      card.appendChild(img);
      card.appendChild(info);
      wrap.appendChild(card);
    });
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }

  function showTyping() {
    var typing = document.createElement("div");
    typing.className = "kpw-typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;
    return typing;
  }

  function openPanel() {
    panel.classList.add("kpw-open");
    if (body.children.length === 0) {
      appendMessage("assistant", GREETING);
    }
    input.focus();
  }

  function closePanel() {
    panel.classList.remove("kpw-open");
  }

  launcherButton.addEventListener("click", function () {
    if (panel.classList.contains("kpw-open")) {
      closePanel();
    } else {
      openPanel();
    }
  });
  closeButton.addEventListener("click", closePanel);

  var sending = false;

  function sendMessage() {
    var text = input.value.trim();
    if (!text || sending) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      appendError("メッセージは" + MAX_MESSAGE_LENGTH + "文字以内で入力してください。");
      return;
    }

    appendMessage("user", text);
    input.value = "";
    sending = true;
    sendButton.disabled = true;

    var typing = showTyping();

    fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: history }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        typing.remove();
        var data = result.data;
        var reply = (data && data.reply) || "エラーが発生しました。時間をおいて再度お試しください。";
        appendMessage("assistant", reply);
        appendProducts(data && data.products);

        history.push({ role: "user", text: text });
        history.push({ role: "assistant", text: reply });
        saveHistory(history);
      })
      .catch(function (err) {
        typing.remove();
        appendError("通信エラーが発生しました。時間をおいて再度お試しください。");
        console.error("[shop-widget]", err);
      })
      .finally(function () {
        sending = false;
        sendButton.disabled = false;
      });
  }

  sendButton.addEventListener("click", sendMessage);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 80) + "px";
  });
})();
