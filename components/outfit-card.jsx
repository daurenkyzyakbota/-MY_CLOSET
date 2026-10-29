'use client';

import Link from 'next/link';
import {useState} from 'react';
import {SEASONS,outfitStatus} from '../lib/model.js';
import {OCCASIONS,STYLE_OPTIONS} from '../lib/stylist.js';
import {createStoreSearchLinks,shoppingDraftFromMissing} from '../lib/shopping.js';
import {useCloset} from './closet-provider.jsx';
import {Icon,ItemArt} from './ui.jsx';
import OutfitForm from './outfit-form.jsx';
import {ShoppingForm} from './shopping-page.jsx';

const plural=(n,one,few,many)=>`${n} ${n%10===1&&n%100!==11?one:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?few:many}`;

export default function OutfitCard({outfit,onEdit}){
  const {state,toggleOutfit}=useCloset();
  const [editing,setEditing]=useState(null);
  const [shopping,setShopping]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const status=outfitStatus(outfit,state.items);
  const missing=outfit.missingItems || [];
  const edit=draft=>onEdit?onEdit(draft):setEditing(draft);
  async function favorite(){if(busy)return;setBusy(true);setError('');try{await toggleOutfit(outfit.id);}catch(cause){setError(cause.message || 'Не удалось сохранить изменение.');}finally{setBusy(false);}}
  return <>
    <article className="outfit-card"><div className="outfit-preview">{status.items.slice(0,4).map(item=><div className="outfit-piece" key={item.id}><ItemArt item={item}/></div>)}{missing.map(item=><div className="missing-piece" key={item.id}><span className="missing-piece-icon"><Icon name="shopping"/></span><span className="missing-piece-label">Нужно добавить</span><strong>{item.name}</strong></div>)}{!status.items.length&&!missing.length&&<div className="empty-preview"><Icon name="outfits"/></div>}<button className={`icon-btn favorite-btn${outfit.favorite?' is-active':''}`} type="button" disabled={busy} aria-label={`${outfit.favorite?'Убрать из избранного':'В избранное'}: ${outfit.name}`} aria-pressed={outfit.favorite} onClick={favorite}><Icon name="heart"/></button></div><div className="card-body"><p className="eyebrow">{plural(status.items.length,'ваша вещь','ваши вещи','ваших вещей')}</p><h3>{outfit.name}</h3><p className={`outfit-completeness${missing.length?' missing-outfit-badge':''}`}>{missing.length?'Требует покупки':status.missing.length?'Проверьте состав':'Полный'}</p><div className="tag-row"><span className="tag">{OCCASIONS[outfit.occasion] || OCCASIONS.everyday}</span>{outfit.style&&<span className="tag">{STYLE_OPTIONS[outfit.style] || outfit.style}</span>}{outfit.season&&<span className="tag">{SEASONS[outfit.season]}</span>}</div>{outfit.description&&<p className="item-meta outfit-description">{outfit.description}</p>}{status.missing.length>0&&<p className="outfit-warning">{plural(status.missing.length,'вещь удалена','вещи удалены','вещей удалены')}. Обновите состав.</p>}{status.unavailable.length>0&&<p className="outfit-warning">Есть вещи в стирке</p>}{!status.missing.length&&!status.unavailable.length&&!missing.length&&<p className="item-meta">Всё готово к выходу</p>}{missing.length>0&&<details className="saved-missing-details"><summary>Недостающие детали · {missing.length}</summary>{missing.map(item=>{const links=createStoreSearchLinks(item);return <div className="saved-missing-item" key={item.id}><strong>{item.name}</strong><p>{item.reason}</p><button type="button" className="btn btn-secondary" onClick={()=>setShopping(shoppingDraftFromMissing(item))}><Icon name="shopping"/>В покупки</button>{links.length>0&&<details className="shopping-store-links"><summary>Поиск похожих</summary><p className="footnote">Откроется поиск в магазине. Наличие, цены и подходящий размер проверяйте на его сайте.</p><div>{links.map(link=><a className="shopping-link" href={link.url} key={link.id || link.name} target="_blank" rel="noopener noreferrer">{link.name} <Icon name="arrow-right"/></a>)}</div></details>}</div>;})}</details>}<div className="card-actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>edit(outfit)}><Icon name="edit"/>Изменить</button><Link className="btn btn-ghost" href={`/calendar?outfit=${encodeURIComponent(outfit.id)}`}><Icon name="calendar"/>В календарь</Link></div>{error&&<p className="form-error" role="alert">{error}</p>}</div></article>
    {editing&&<OutfitForm key={editing.id || 'new-outfit'} outfit={editing} onClose={()=>setEditing(null)}/>}
    {shopping&&<ShoppingForm entry={shopping} onClose={()=>setShopping(null)}/>}
  </>;
}
