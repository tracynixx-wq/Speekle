(() => {
  const cfg = window.SPEEKLY_CONFIG || {};
  const status = (id, message) => { document.getElementById(id).textContent = message || ""; };
  const authView = document.getElementById("auth-view");
  const chatView = document.getElementById("chat-view");
  if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR_") || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes("YOUR_")) {
    status("auth-status", "Сначала укажите URL и publishable/anon key в config.js.");
    return;
  }
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  let user = null, activeChat = null, realtime = null;
  const $ = id => document.getElementById(id);
  async function showSession() {
    const { data: { session } } = await db.auth.getSession();
    user = session?.user || null;
    authView.hidden = !!user;
    chatView.hidden = !user;
    if (user) {
      $("account-label").textContent = user.email || user.id;
      await loadChats();
    }
  }
  $("auth-form").addEventListener("submit", async e => {
    e.preventDefault();
    status("auth-status", "Входим…");
    const { error } = await db.auth.signInWithPassword({ email: $("email").value, password: $("password").value });
    status("auth-status", error?.message || "");
    if (!error) await showSession();
  });
  $("signup-button").addEventListener("click", async () => {
    status("auth-status", "Создаём аккаунт…");
    const { error } = await db.auth.signUp({ email: $("email").value, password: $("password").value });
    status("auth-status", error?.message || "Регистрация отправлена. Если включено подтверждение email, проверьте почту.");
  });
  $("logout-button").addEventListener("click", async () => { await db.auth.signOut(); activeChat = null; await showSession(); });
  async function loadChats() {
    const { data, error } = await db.from("conversation_members").select("conversation_id, conversations(id, created_at)").eq("user_id", user.id);
    if (error) return status("app-status", error.message);
    const list = $("chat-list"); list.replaceChildren();
    (data || []).forEach(row => {
      const button = document.createElement("button");
      button.textContent = "Чат · " + row.conversation_id.slice(0, 8);
      button.classList.toggle("active", activeChat === row.conversation_id);
      button.addEventListener("click", () => openChat(row.conversation_id));
      const li = document.createElement("li"); li.append(button); list.append(li);
    });
  }
  $("new-chat-form").addEventListener("submit", async e => {
    e.preventDefault();
    const peer = $("peer-id").value.trim();
    if (!peer || peer === user.id) return status("app-status", "Укажите UUID другого пользователя.");
    status("app-status", "Создаём чат…");
    const { data: conversation, error } = await db.from("conversations").insert({ created_by: user.id }).select().single();
    if (error) return status("app-status", error.message);
    const { error: membersError } = await db.from("conversation_members").insert([
      { conversation_id: conversation.id, user_id: user.id },
      { conversation_id: conversation.id, user_id: peer }
    ]);
    if (membersError) { status("app-status", membersError.message); return; }
    $("peer-id").value = "";
    await loadChats(); await openChat(conversation.id);
    status("app-status", "");
  });
  async function openChat(id) {
    activeChat = id; $("empty-state").hidden = true; $("conversation").hidden = false;
    $("conversation-title").textContent = "Диалог " + id.slice(0, 8);
    if (realtime) await db.removeChannel(realtime);
    await loadMessages();
    realtime = db.channel("messages-" + id).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "conversation_id=eq." + id }, payload => appendMessage(payload.new)).subscribe();
    await loadChats();
  }
  function appendMessage(m) {
    if (document.querySelector('[data-message-id="' + m.id + '"]')) return;
    const li = document.createElement("li"); li.dataset.messageId = m.id;
    li.classList.toggle("mine", m.sender_id === user.id);
    li.append(document.createTextNode(m.body));
    const meta = document.createElement("small"); meta.textContent = new Date(m.created_at).toLocaleString(); li.append(meta);
    $("messages").append(li); $("messages").scrollTop = $("messages").scrollHeight;
  }
  async function loadMessages() {
    $("messages").replaceChildren();
    const { data, error } = await db.from("messages").select("id, sender_id, body, created_at").eq("conversation_id", activeChat).order("created_at", { ascending: true }).limit(200);
    if (error) return status("app-status", error.message);
    (data || []).forEach(appendMessage);
  }
  $("message-form").addEventListener("submit", async e => {
    e.preventDefault();
    const body = $("message-input").value.trim();
    if (!body || !activeChat) return;
    $("message-input").disabled = true;
    const { error } = await db.from("messages").insert({ conversation_id: activeChat, sender_id: user.id, body });
    $("message-input").disabled = false;
    if (error) return status("app-status", error.message);
    $("message-input").value = ""; status("app-status", "");
  });
  db.auth.onAuthStateChange(() => { setTimeout(showSession, 0); });
  showSession();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
})();