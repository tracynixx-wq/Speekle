(() => {
  const cfg = window.SPEEKLY_CONFIG || {};
  const $ = id => document.getElementById(id);
  const status = (id, value) => { const el=$(id); if(el) el.textContent=value||""; };
  const authView=$("auth-view"), profileView=$("profile-view"), mainView=$("main-view");
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    status("auth-status","Не удалось подключиться к серверу. Проверь config.js."); return;
  }
  const db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  let user=null, profile=null, activeChat=null, realtime=null, allContacts=[], chatRows=[], editMode=false;

  function initials(name){return (name||"S").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase()||"S";}
  function avatar(name,kind=""){const el=document.createElement("div");el.className="chat-avatar "+kind;el.textContent=initials(name);return el;}
  function showPage(page){
    ["chats","contacts","profile","settings"].forEach(name=>{const el=$(name+"-page");if(el)el.hidden=name!==page;});
    $("conversation-page").hidden=true;$("bottom-nav").hidden=false;
    $("top-title").textContent=page==="chats"?"Чаты":page==="contacts"?"Контакты":page==="profile"?"Профиль":"Настройки";
    document.querySelectorAll(".nav-button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    $("top-left").textContent=page==="chats"?(editMode?"Готово":"Изм."):"";
    $("search-panel").hidden=true;
    if(page==="contacts")loadContacts();
  }
  async function showSession(){
    const {data:{session}}=await db.auth.getSession();
    user=session?.user||null;authView.hidden=!!user;profileView.hidden=true;mainView.hidden=true;
    if(!user)return;
    const {data:p,error}=await db.from("profiles").select("id,display_name,username,avatar_url").eq("id",user.id).maybeSingle();
    if(error){status("auth-status",error.message);authView.hidden=false;return;}
    profile=p;
    if(!p?.display_name||!p?.username){profileView.hidden=false;$("display-name").value=p?.display_name||"";$("username").value=p?.username||"";return;}
    mainView.hidden=false;
    updateProfileUI();
    await ensureDemoChat();
    await loadChats();
    showPage("chats");
  }
  function updateProfileUI(){
    $("profile-name").textContent=profile.display_name;
    $("profile-handle").textContent="@"+profile.username;
    const avatarUrl=profile.avatar_url||"";
    ["profile-avatar","profile-small-avatar","settings-avatar"].forEach(id=>{
      const el=$(id);if(!el)return;
      el.textContent=avatarUrl?"":initials(profile.display_name);
      el.style.backgroundImage=avatarUrl?"url("+JSON.stringify(avatarUrl)+")":"";
      el.style.backgroundSize="cover";el.style.backgroundPosition="center";
    });
    $("profile-account-name").textContent=profile.display_name;
    $("profile-account-email").textContent=user?.email||"";
    $("settings-name").textContent=profile.display_name;
    $("settings-handle").textContent="@"+profile.username;
  }

  $("auth-form").addEventListener("submit",async e=>{
    e.preventDefault();status("auth-status","Входим…");
    const {error}=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
    if(error)status("auth-status",error.message);else await showSession();
  });
  $("signup-button").addEventListener("click",async()=>{
    status("auth-status","Создаём аккаунт…");
    const {error}=await db.auth.signUp({email:$("email").value.trim(),password:$("password").value});
    status("auth-status",error?.message||"Регистрация отправлена. Если нужно, подтверди email и войди.");
  });
  $("profile-form").addEventListener("submit",async e=>{
    e.preventDefault();const display_name=$("display-name").value.trim();
    const username=$("username").value.trim().replace(/^@/,"").toLowerCase();
    if(display_name.length<2)return status("profile-status","Имя должно быть не короче двух символов.");
    if(!/^[a-z0-9_]{3,24}$/.test(username))return status("profile-status","Юзернейм: 3–24 символа, латиница, цифры и _.");
    status("profile-status","Сохраняем…");
    const {error}=await db.from("profiles").upsert({id:user.id,display_name,username},{onConflict:"id"});
    if(error)return status("profile-status",error.code==="23505"?"Этот юзернейм уже занят.":"Не удалось сохранить: "+error.message);
    await showSession();
  });

  async function ensureDemoChat(){
    const title="Яблочный чат 🍎";
    let {data:chat,error}=await db.from("conversations").select("id,title").eq("created_by",user.id).eq("title",title).maybeSingle();
    if(error)return status("app-status",error.message);
    if(!chat){const made=await db.from("conversations").insert({created_by:user.id,title}).select("id,title").single();if(made.error)return status("app-status",made.error.message);chat=made.data;}
    const {error:memberError}=await db.from("conversation_members").upsert({conversation_id:chat.id,user_id:user.id},{onConflict:"conversation_id,user_id",ignoreDuplicates:true});
    if(memberError)return status("app-status",memberError.message);
    const {count,error:countError}=await db.from("messages").select("id",{count:"exact",head:true}).eq("conversation_id",chat.id).eq("is_demo",true);
    if(countError)return status("app-status",countError.message);
    if(!count){
      const samples=[
        "Привет! Это тестовый чат Speekly. Сегодня обсуждаем яблоки 🍎",
        "Яблоки бывают сладкими, кислыми и даже пряными на вкус. Всё зависит от сорта.",
        "Интересный факт: яблоки продолжают медленно дозревать после сбора, поэтому их хранят в прохладе.",
        "В яблоках есть пищевые волокна, а ещё они отлично подходят для домашнего пирога 🥧",
        "Какое яблоко тебе больше нравится — зелёное кислое или красное сладкое? 😊"
      ];
      const {error}=await db.from("messages").insert(samples.map(body=>({conversation_id:chat.id,sender_id:user.id,body,is_demo:true})));
      if(error)status("app-status",error.message);
    }
  }

  async function loadChats(){
    const {data,error}=await db.from("conversation_members").select("conversation_id,conversations(id,title,created_at)").eq("user_id",user.id);
    if(error)return status("app-status",error.message);
    const rows=(data||[]).filter(x=>x.conversations).map(x=>({id:x.conversation_id,...x.conversations}));
    const ids=rows.map(x=>x.id);let latest={};
    if(ids.length){const res=await db.from("messages").select("conversation_id,body,created_at,is_demo").in("conversation_id",ids).order("created_at",{ascending:false}).limit(100);if(!res.error)(res.data||[]).forEach(m=>{if(!latest[m.conversation_id])latest[m.conversation_id]=m;});}
    chatRows=rows.map(x=>({...x,last:latest[x.id]})).sort((a,b)=>new Date(b.last?.created_at||b.created_at)-new Date(a.last?.created_at||a.created_at));
    const list=$("chat-list");list.replaceChildren();$("chats-empty").hidden=chatRows.length>0;
    chatRows.forEach(chat=>{
      const row=document.createElement("div");row.className="chat-row";row.tabIndex=0;
      row.append(avatar(chat.title,chat.title.includes("Яблочный")?"apple":""));
      const copy=document.createElement("div");copy.className="chat-copy";
      const line=document.createElement("div");line.className="chat-title-line";
      const title=document.createElement("strong");title.textContent=chat.title||"Диалог";
      const time=document.createElement("span");time.className="chat-time";time.textContent=chat.last?new Date(chat.last.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"";
      line.append(title,time);
      const preview=document.createElement("div");preview.className="chat-preview";preview.textContent=chat.last?(chat.last.is_demo?"Speekly: ":"Вы: ")+chat.last.body:"Нет сообщений";
      copy.append(line,preview);row.append(copy);
      const open=()=>openChat(chat.id,chat.title);
      row.addEventListener("click",open);row.addEventListener("keydown",e=>{if(e.key==="Enter")open();});
      if(editMode){const mark=document.createElement("span");mark.textContent="☰";mark.style.color="var(--muted)";row.prepend(mark);}
      list.append(row);
    });
    filterChats();
  }
  function filterChats(){
    const q=($("global-search").value||"").trim().toLowerCase();
    document.querySelectorAll(".chat-row").forEach(row=>row.hidden=q&&!row.textContent.toLowerCase().includes(q));
  }

  async function loadContacts(){
    const {data,error}=await db.from("profiles").select("id,display_name,username").neq("id",user.id).order("display_name");
    if(error)return status("app-status",error.message);
    allContacts=data||[];renderContacts();
  }
  function renderContacts(){
    const q=$("contact-search").value.trim().toLowerCase(),list=$("contact-list");list.replaceChildren();
    const matches=allContacts.filter(p=>(p.display_name+" "+p.username).toLowerCase().includes(q));
    $("contact-count").textContent=matches.length;
    matches.forEach(p=>{
      const row=document.createElement("div");row.className="contact-row";row.append(avatar(p.display_name));
      const copy=document.createElement("div");copy.className="chat-copy";
      const name=document.createElement("strong");name.textContent=p.display_name;
      const handle=document.createElement("div");handle.className="chat-preview";handle.textContent="@"+p.username;
      copy.append(name,handle);const button=document.createElement("button");button.textContent="Написать";button.addEventListener("click",()=>createChat(p));
      row.append(copy,button);list.append(row);
    });
    if(!matches.length){const empty=document.createElement("p");empty.className="empty-state";empty.textContent="Контакты не найдены";list.append(empty);}
  }
  $("contact-search").addEventListener("input",renderContacts);

  async function findPeer(){
    const username=$("peer-username").value.trim().replace(/^@/,"").toLowerCase();
    if(!username)return;
    $("user-result").textContent="Ищем…";
    const {data:peer,error}=await db.from("profiles").select("id,display_name,username").eq("username",username).maybeSingle();
    if(error){$("user-result").textContent=error.message;return;}
    if(!peer){$("user-result").textContent="Пользователь не найден.";return;}
    if(peer.id===user.id){$("user-result").textContent="Это твой профиль.";return;}
    $("user-result").replaceChildren();
    const info=document.createElement("p");info.textContent=peer.display_name+" · @"+peer.username;
    const button=document.createElement("button");button.textContent="Открыть чат";button.addEventListener("click",()=>createChat(peer));
    $("user-result").append(info,button);
  }
  $("new-chat-form").addEventListener("submit",async e=>{e.preventDefault();await findPeer();});
  async function createChat(peer){
    status("app-status","Создаём чат…");
    const {data:conversation,error}=await db.from("conversations").insert({created_by:user.id,title:peer.display_name}).select("id,title").single();
    if(error){status("app-status",error.message);return;}
    const {error:membersError}=await db.from("conversation_members").insert([{conversation_id:conversation.id,user_id:user.id},{conversation_id:conversation.id,user_id:peer.id}]);
    if(membersError){status("app-status",membersError.message);return;}
    $("new-chat-dialog").close();$("peer-username").value="";$("user-result").replaceChildren();
    await loadChats();await openChat(conversation.id,conversation.title);
  }

  async function openChat(id,title){
    activeChat=id;$("conversation-page").hidden=false;$("bottom-nav").hidden=true;
    $("conversation-title").textContent=title||"Диалог";
    $("conversation-avatar").textContent=initials(title);
    $("conversation-subtitle").textContent="чат Speekly";
    if(realtime)await db.removeChannel(realtime);
    await loadMessages();
    realtime=db.channel("messages-"+id).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:"conversation_id=eq."+id},payload=>appendMessage(payload.new)).subscribe();
  }
  function appendMessage(message){
    if($("messages").querySelector('[data-message-id="'+message.id+'"]'))return;
    const item=document.createElement("div");item.className="message";item.dataset.messageId=message.id;
    item.classList.toggle("mine",!message.is_demo&&message.sender_id===user.id);item.classList.toggle("demo",!!message.is_demo);
    if(message.is_demo){const author=document.createElement("div");author.className="message-author";author.textContent="Speekly";item.append(author);}
    item.append(document.createTextNode(message.body));
    const time=document.createElement("small");time.className="message-time";time.textContent=new Date(message.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});item.append(time);
    $("messages").append(item);$("messages").scrollTop=$("messages").scrollHeight;
  }
  async function loadMessages(){
    $("messages").replaceChildren();
    const {data,error}=await db.from("messages").select("id,sender_id,body,created_at,is_demo").eq("conversation_id",activeChat).order("created_at",{ascending:true}).limit(200);
    if(error)return status("app-status",error.message);(data||[]).forEach(appendMessage);
  }
  $("message-form").addEventListener("submit",async e=>{
    e.preventDefault();const body=$("message-input").value.trim();if(!body||!activeChat)return;
    const button=$("message-form").querySelector("button");button.disabled=true;
    const {error}=await db.from("messages").insert({conversation_id:activeChat,sender_id:user.id,body});
    button.disabled=false;if(error)return status("app-status",error.message);
    $("message-input").value="";status("app-status","");
  });

  document.querySelectorAll(".nav-button").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
  $("settings-profile-button").addEventListener("click",()=>showPage("profile"));
  $("add-profile-button").addEventListener("click",()=>status("app-status","Добавление нескольких аккаунтов пока не подключено."));
  document.querySelectorAll("[data-theme]").forEach(b=>b.addEventListener("click",()=>{document.documentElement.dataset.theme=b.dataset.theme==="light"?"light":"dark";document.querySelectorAll("[data-theme]").forEach(x=>x.classList.toggle("selected",x===b));localStorage.setItem("speekly-theme",b.dataset.theme);}));
  document.querySelectorAll("[data-accent]").forEach(b=>b.addEventListener("click",()=>{document.documentElement.style.setProperty("--accent",b.dataset.accent);document.querySelectorAll("[data-accent]").forEach(x=>x.classList.toggle("selected",x===b));localStorage.setItem("speekly-accent",b.dataset.accent);}));
  const savedTheme=localStorage.getItem("speekly-theme");if(savedTheme){document.documentElement.dataset.theme=savedTheme==="light"?"light":"dark";document.querySelectorAll("[data-theme]").forEach(x=>x.classList.toggle("selected",x.dataset.theme===savedTheme));}
  const savedAccent=localStorage.getItem("speekly-accent");if(savedAccent){document.documentElement.style.setProperty("--accent",savedAccent);document.querySelectorAll("[data-accent]").forEach(x=>x.classList.toggle("selected",x.dataset.accent===savedAccent));}
  $("back-to-chats").addEventListener("click",async()=>{if(realtime){await db.removeChannel(realtime);realtime=null;}$("conversation-page").hidden=true;showPage("chats");await loadChats();});
  $("compose-button").addEventListener("click",()=>{$("new-chat-dialog").showModal();$("user-result").replaceChildren();});
  $("close-new-chat").addEventListener("click",()=>$("new-chat-dialog").close());
  $("search-toggle").addEventListener("click",()=>{$("search-panel").hidden=!$("search-panel").hidden;if(!$("search-panel").hidden)$("global-search").focus();});
  $("global-search").addEventListener("input",filterChats);
  $("top-left").addEventListener("click",()=>{editMode=!editMode;$("top-left").textContent=editMode?"Готово":"Изм.";loadChats();});
  $("choose-avatar-button").addEventListener("click",()=>$("avatar-file").click());
  $("avatar-file").addEventListener("change",async()=>{
    const file=$("avatar-file").files?.[0];if(!file)return;
    if(file.size>5*1024*1024){status("app-status","Фото должно быть меньше 5 МБ.");return;}
    const ext=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg";
    const path=user.id+"/avatar-"+Date.now()+"."+ext;
    status("app-status","Загружаем фотографию…");
    const {error:uploadError}=await db.storage.from("avatars").upload(path,file,{upsert:true,contentType:file.type});
    if(uploadError){status("app-status","Не удалось загрузить фото: "+uploadError.message);return;}
    const {data}=db.storage.from("avatars").getPublicUrl(path);
    const {error:updateError}=await db.from("profiles").update({avatar_url:data.publicUrl}).eq("id",user.id);
    if(updateError){status("app-status",updateError.message);return;}
    profile={...profile,avatar_url:data.publicUrl};updateProfileUI();status("app-status","Фотография профиля обновлена.");
  });
  $("edit-profile-button").addEventListener("click",()=>{$("edit-display-name").value=profile.display_name;$("edit-username").value=profile.username;$("edit-profile-status").textContent="";$("edit-profile-dialog").showModal();});
  $("close-profile-dialog").addEventListener("click",()=>$("edit-profile-dialog").close());
  $("edit-profile-form").addEventListener("submit",async e=>{
    e.preventDefault();const display_name=$("edit-display-name").value.trim(),username=$("edit-username").value.trim().replace(/^@/,"").toLowerCase();
    if(display_name.length<2||!/^[a-z0-9_]{3,24}$/.test(username))return status("edit-profile-status","Проверь имя и юзернейм (3–24 символа).");
    const {error}=await db.from("profiles").upsert({id:user.id,display_name,username},{onConflict:"id"});
    if(error)return status("edit-profile-status",error.code==="23505"?"Юзернейм уже занят.":error.message);
    profile={...profile,display_name,username};updateProfileUI();$("edit-profile-dialog").close();
  });
  document.querySelectorAll("[data-setting]").forEach(b=>b.addEventListener("click",()=>status("app-status",b.dataset.setting+" — раздел пока в разработке.")));
  $("logout-button").addEventListener("click",async()=>{if(realtime)await db.removeChannel(realtime);await db.auth.signOut();activeChat=null;await showSession();});

  db.auth.onAuthStateChange(()=>{setTimeout(showSession,0);});
  showSession();
  if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
})();