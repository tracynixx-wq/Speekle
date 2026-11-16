(() => {
  const cfg = window.SPEEKLY_CONFIG || {};
  const $ = id => document.getElementById(id);
  const status = (id, message) => { $(id).textContent = message || ""; };
  const authView = $("auth-view"), profileView = $("profile-view"), chatView = $("chat-view");
  if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR_") || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes("YOUR_")) {
    status("auth-status", "Сначала укажите URL и publishable/anon key в config.js.");
    return;
  }

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  let user = null, activeChat = null, realtime = null, currentProfile = null;

  async function showSession() {
    const { data: { session } } = await db.auth.getSession();
    user = session?.user || null;
    authView.hidden = !!user;
    profileView.hidden = true;
    chatView.hidden = true;
    if (!user) return;

    const { data: profile, error } = await db.from("profiles")
      .select("id, display_name, username").eq("id", user.id).maybeSingle();
    if (error) return status("auth-status", error.message);
    currentProfile = profile;
    if (!profile || !profile.display_name || !profile.username) {
      profileView.hidden = false;
      $("display-name").value = profile?.display_name || "";
      $("username").value = profile?.username || "";
      return;
    }
    chatView.hidden = false;
    $("account-label").textContent = profile.display_name + " · @" + profile.username;
    await ensureDemoChat();
    await loadChats();
  }

  $("auth-form").addEventListener("submit", async e => {
    e.preventDefault();
    status("auth-status", "Входим…");
    const { error } = await db.auth.signInWithPassword({
      email: $("email").value.trim(), password: $("password").value
    });
    status("auth-status", error?.message || "");
    if (!error) await showSession();
  });

  $("signup-button").addEventListener("click", async () => {
    status("auth-status", "Создаём аккаунт…");
    const { error } = await db.auth.signUp({
      email: $("email").value.trim(), password: $("password").value
    });
    status("auth-status", error?.message || "Регистрация отправлена. Если требуется подтверждение email, проверьте почту.");
  });

  $("profile-form").addEventListener("submit", async e => {
    e.preventDefault();
    const display_name = $("display-name").value.trim();
    const username = $("username").value.trim().replace(/^@/, "");
    if (display_name.length < 2) return status("profile-status", "Имя должно содержать минимум 2 символа.");
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return status("profile-status", "Юзернейм: 3–24 символа, латинские буквы, цифры или _.");
    status("profile-status", "Сохраняем профиль…");
    const { error } = await db.from("profiles").upsert({
      id: user.id, display_name, username
    }, { onConflict: "id" });
    if (error) {
      status("profile-status", error.code === "23505" ? "Этот юзернейм уже занят. Выбери другой." : error.message);
      return;
    }
    await showSession();
  });

  $("logout-button").addEventListener("click", async () => {
    if (realtime) await db.removeChannel(realtime);
    await db.auth.signOut();
    activeChat = null;
    await showSession();
  });

  async function ensureDemoChat() {
    const title = "Яблочный чат 🍎";
    let { data: chat, error } = await db.from("conversations")
      .select("id").eq("created_by", user.id).eq("title", title).maybeSingle();
    if (error) return status("app-status", error.message);
    if (!chat) {
      const result = await db.from("conversations")
        .insert({ created_by: user.id, title }).select("id").single();
      if (result.error) return status("app-status", result.error.message);
      chat = result.data;
    }
    const { error: memberError } = await db.from("conversation_members")
      .upsert({ conversation_id: chat.id, user_id: user.id }, { onConflict: "conversation_id,user_id", ignoreDuplicates: true });
    if (memberError) return status("app-status", memberError.message);

    const { count, error: countError } = await db.from("messages")
      .select("id", { count: "exact", head: true }).eq("conversation_id", chat.id).eq("is_demo", true);
    if (countError) return status("app-status", countError.message);
    if (!count) {
      const samples = [
        "Привет! Это тестовый чат Speekly. Сегодня обсуждаем яблоки 🍎",
        "Яблоки бывают сладкими, кислыми и даже пряными на вкус. Всё зависит от сорта.",
        "Интересный факт: яблоки продолжают медленно дозревать после сбора, поэтому их хранят в прохладе.",
        "В яблоке много воды и пищевых волокон. А ещё оно отлично подходит для пирога 🥧",
        "Какое яблоко тебе больше нравится — зелёное кислое или красное сладкое? 😊"
      ];
      const { error } = await db.from("messages").insert(samples.map(body => ({
        conversation_id: chat.id, sender_id: user.id, body, is_demo: true
      })));
      if (error) status("app-status", error.message);
    }
  }

  async function loadChats() {
    const { data, error } = await db.from("conversation_members")
      .select("conversation_id, conversations(id, title, created_at)")
      .eq("user_id", user.id);
    if (error) return status("app-status", error.message);
    const list = $("chat-list");
    list.replaceChildren();
    (data || []).forEach(row => {
      const chat = row.conversations;
      if (!chat) return;
      const button = document.createElement("button");
      button.textContent = chat.title || ("Диалог · " + row.conversation_id.slice(0, 8));
      button.classList.toggle("active", activeChat === row.conversation_id);
      button.addEventListener("click", () => openChat(row.conversation_id, chat.title));
      const li = document.createElement("li");
      li.append(button);
      list.append(li);
    });
  }

  $("new-chat-form").addEventListener("submit", async e => {
    e.preventDefault();
    const username = $("peer-username").value.trim().replace(/^@/, "");
    if (!username) return;
    status("app-status", "Ищем пользователя…");
    $("user-result").replaceChildren();
    const { data: peer, error } = await db.from("profiles")
      .select("id, username, display_name").ilike("username", username).maybeSingle();
    if (error) return status("app-status", error.message);
    if (!peer) return status("app-status", "Пользователь не найден. Проверь юзернейм.");
    if (peer.id === user.id) return status("app-status", "Это твой собственный профиль.");
    const info = document.createElement("p");
    info.textContent = peer.display_name + " · @" + peer.username;
    const openButton = document.createElement("button");
    openButton.textContent = "Написать";
    openButton.addEventListener("click", () => createChat(peer));
    $("user-result").append(info, openButton);
    status("app-status", "");
  });

  async function createChat(peer) {
    status("app-status", "Создаём чат…");
    const { data: conversation, error } = await db.from("conversations")
      .insert({ created_by: user.id, title: peer.display_name + " · @" + peer.username })
      .select("id, title").single();
    if (error) return status("app-status", error.message);
    const { error: membersError } = await db.from("conversation_members").insert([
      { conversation_id: conversation.id, user_id: user.id },
      { conversation_id: conversation.id, user_id: peer.id }
    ]);
    if (membersError) return status("app-status", membersError.message);
    $("peer-username").value = "";
    $("user-result").replaceChildren();
    await loadChats();
    await openChat(conversation.id, conversation.title);
    status("app-status", "");
  }

  async function openChat(id, title) {
    activeChat = id;
    $("empty-state").hidden = true;
    $("conversation").hidden = false;
    $("conversation-title").textContent = title || "Диалог";
    if (realtime) await db.removeChannel(realtime);
    await loadMessages();
    realtime = db.channel("messages-" + id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "conversation_id=eq." + id },
        payload => appendMessage(payload.new))
      .subscribe();
    await loadChats();
  }

  function appendMessage(message) {
    if (document.querySelector('[data-message-id="' + message.id + '"]')) return;
    const li = document.createElement("li");
    li.dataset.messageId = message.id;
    li.classList.toggle("mine", !message.is_demo && message.sender_id === user.id);
    li.classList.toggle("demo-message", !!message.is_demo);
    if (message.is_demo) {
      const author = document.createElement("strong");
      author.textContent = "Speekly";
      li.append(author);
    }
    li.append(document.createTextNode(message.body));
    const meta = document.createElement("small");
    meta.textContent = new Date(message.created_at).toLocaleString();
    li.append(meta);
    $("messages").append(li);
    $("messages").scrollTop = $("messages").scrollHeight;
  }

  async function loadMessages() {
    $("messages").replaceChildren();
    const { data, error } = await db.from("messages")
      .select("id, sender_id, body, created_at, is_demo")
      .eq("conversation_id", activeChat).order("created_at", { ascending: true }).limit(200);
    if (error) return status("app-status", error.message);
    (data || []).forEach(appendMessage);
  }

  $("message-form").addEventListener("submit", async e => {
    e.preventDefault();
    const body = $("message-input").value.trim();
    if (!body || !activeChat) return;
    $("message-input").disabled = true;
    const { error } = await db.from("messages").insert({
      conversation_id: activeChat, sender_id: user.id, body
    });
    $("message-input").disabled = false;
    if (error) return status("app-status", error.message);
    $("message-input").value = "";
    status("app-status", "");
  });

  db.auth.onAuthStateChange(() => { setTimeout(showSession, 0); });
  showSession();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
})();