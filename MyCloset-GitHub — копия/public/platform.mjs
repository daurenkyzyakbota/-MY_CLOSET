import { QrCode } from './qrcode.mjs';

export const HOSTED_URL = 'https://mycloset-bota-wardrobe.rockynewt20.chatgpt.site/';
let installPrompt = null;
let initialized = false;
let updateRegistration = null;
let reloadForUpdate = false;
let offlineReady = false;
const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const announce = (message,error=false) => {
  document.querySelectorAll('[data-platform-message]').forEach(node=>{node.textContent=message;});
  window.dispatchEvent(new CustomEvent('mycloset-platform-notice',{detail:{message,error}}));
};
const notifyChange = () => { attachPlatformUI();window.dispatchEvent(new Event('mycloset-platform-change')); };

export function getInstallState() { return {canPrompt:!!installPrompt,installed:installed(),secure:window.isSecureContext,ios:/iPad|iPhone|iPod/.test(navigator.userAgent),offlineReady,updateAvailable:!!updateRegistration?.waiting}; }

export async function requestAppJson(path) {
  const url = new URL(path,location.href);
  if (url.origin !== location.origin) throw new Error('Недопустимый адрес запроса.');
  const hosted = location.hostname === new URL(HOSTED_URL).hostname || document.querySelector('meta[name="mycloset-hosting"]')?.content === 'online';
  if (url.pathname === '/api/device' && hosted) {
    const address = new URL('./',location.href).href;
    const hostedAddress = location.protocol==='https:'?address:HOSTED_URL;
    return {localUrl:address,phoneUrls:[hostedAddress],preferredPhoneUrl:hostedAddress,hostedUrl:hostedAddress,isHosted:true};
  }
  const response = await fetch(url,{headers:{Accept:'application/json'}});
  let data;
  try { data = await response.json(); } catch { throw new Error('Сервер вернул непонятный ответ. Попробуйте ещё раз.'); }
  if (!response.ok) throw new Error(data.error || 'Не удалось загрузить данные.');
  return data;
}

export function renderConnectionQr(container,address) {
  if (!container || !address) return;
  const url = new URL(address);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || address.length > 500) throw new Error('Недопустимый адрес для QR-кода.');
  const qr = QrCode.encodeText(url.href,QrCode.Ecc.MEDIUM);
  const border = 4, size = qr.size + border*2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 '+size+' '+size);
  svg.setAttribute('width','232');svg.setAttribute('height','232');svg.setAttribute('role','img');
  svg.setAttribute('aria-label','QR-код для открытия MyCloset на другом устройстве');
  svg.setAttribute('shape-rendering','crispEdges');
  const background = document.createElementNS(svg.namespaceURI,'rect');
  background.setAttribute('width','100%');background.setAttribute('height','100%');background.setAttribute('fill','#ffffff');
  svg.append(background);
  const path = document.createElementNS(svg.namespaceURI,'path');
  const parts=[];
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))parts.push('M'+(x+border)+','+(y+border)+'h1v1h-1z');
  path.setAttribute('d',parts.join(' '));path.setAttribute('fill','#352333');svg.append(path);
  container.replaceChildren(svg);
}

async function copyAddress(button) {
  const address = button.dataset.platformUrl || HOSTED_URL;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(address);
    else {
      const input=document.createElement('textarea');input.value=address;input.setAttribute('readonly','');input.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';document.body.append(input);
      input.select();const copied=document.execCommand('copy');input.remove();button.focus({preventScroll:true});
      if(!copied)throw new Error('Copy unavailable');
    }
    announce('Ссылка скопирована. Откройте её на другом устройстве.');
  }catch{announce('Не удалось скопировать автоматически. Выделите адрес и скопируйте его вручную.',true);}
}

async function installApp() {
  if (installed()) { announce('MyCloset уже открыт как приложение.');return; }
  if (installPrompt) {
    const prompt=installPrompt;installPrompt=null;notifyChange();
    try { await prompt.prompt();const result=await prompt.userChoice;announce(result.outcome==='accepted'?'Установка подтверждена. Значок появится на устройстве.':'Можно установить MyCloset позже через меню браузера.'); }
    catch{announce('Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».');}
    return;
  }
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) announce('На iPhone: откройте сайт в Safari → «Поделиться» → «На экран Домой».');
  else if (!window.isSecureContext) announce('Для установки откройте интернет-версию MyCloset по защищённой ссылке.');
  else announce('В меню браузера выберите «Установить MyCloset» или «Добавить на главный экран». Кнопка установки появится, когда браузер будет готов.');
}

export function attachPlatformUI(root=document) {
  root.querySelectorAll('[data-platform-status]').forEach(node=>{node.textContent=navigator.onLine?'В сети':'Без интернета';node.classList.toggle('is-offline',!navigator.onLine);});
  root.querySelectorAll('[data-platform-install]').forEach(node=>{
    let label=node.querySelector('[data-platform-install-label]');
    if(!label){for(const child of [...node.childNodes])if(child.nodeType===Node.TEXT_NODE)child.remove();label=document.createElement('span');label.dataset.platformInstallLabel='';node.append(label);}
    label.textContent=installed()?'Приложение установлено':'Добавить на экран';node.setAttribute('aria-label',installed()?'MyCloset уже установлен':'Добавить MyCloset на экран устройства');
  });
  root.querySelectorAll('[data-platform-update]').forEach(node=>{node.hidden=!updateRegistration?.waiting;});
  root.querySelectorAll('[data-platform-offline-ready]').forEach(node=>{node.textContent=offlineReady?'Гардероб доступен и без интернета после первого открытия.':'Для первого открытия нужен интернет.';});
}

export function initializePlatform() {
  if (initialized) return;
  initialized=true;
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;notifyChange();});
  window.addEventListener('appinstalled',()=>{installPrompt=null;notifyChange();announce('MyCloset установлен. Открывайте его с главного экрана.');});
  window.addEventListener('online',notifyChange);window.addEventListener('offline',notifyChange);
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('[data-platform-install],[data-platform-copy],[data-platform-update]');if(!target)return;
    if(target.hasAttribute('data-platform-copy'))void copyAddress(target);
    else if(target.hasAttribute('data-platform-update')){if(updateRegistration?.waiting){reloadForUpdate=true;updateRegistration.waiting.postMessage({type:'SKIP_WAITING'});}}
    else void installApp();
  });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloadForUpdate)location.reload();});
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(registration=>{
      updateRegistration=registration;
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;
        worker?.addEventListener('statechange',()=>{if(worker.state==='installed'){offlineReady=true;notifyChange();}});
      });
      void navigator.serviceWorker.ready.then(()=>{offlineReady=true;notifyChange();});
      notifyChange();
    }).catch(()=>{offlineReady=false;notifyChange();});
  }
  attachPlatformUI();
}
