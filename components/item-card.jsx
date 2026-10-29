'use client';

import {useState} from 'react';
import {CATEGORIES, COLORS, SEASONS, SUBCATEGORIES, WARMTH_OPTIONS, RAINPROOF_OPTIONS} from '../lib/model.js';
import {STYLE_OPTIONS} from '../lib/stylist.js';
import {useCloset} from './closet-provider.jsx';
import {ColorDots, ConfirmDialog, Icon, ItemArt, Modal} from './ui.jsx';
import ItemForm from './item-form.jsx';

export default function ItemCard({item, onEdit}) {
  const {toggleItem,removeItem} = useCloset();
  const [details,setDetails] = useState(false);
  const [editing,setEditing] = useState(false);
  const [confirmDelete,setConfirmDelete] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function toggle(key) {if (busy) return;setBusy(true);setError('');try {await toggleItem(item.id,key);}catch(cause){setError(cause.message || 'Не удалось сохранить изменение.');}finally{setBusy(false);}}
  async function remove() {setBusy(true);setError('');try {await removeItem(item.id);setConfirmDelete(false);}catch(cause){setError(cause.message || 'Вещь не удалена.');setConfirmDelete(false);}finally{setBusy(false);}}
  const edit = () => {setDetails(false);if(onEdit)onEdit(item);else setEditing(true);};
  const properties = [['Категория',CATEGORIES[item.category]],['Тип вещи',SUBCATEGORIES[item.category]?.[item.subcategory]],['Бренд',item.brand],['Размер',item.size],['Материал',item.material],['Стиль',STYLE_OPTIONS[item.style] || item.style],['Сезоны',item.seasons.map(value=>SEASONS[value]).join(', ')],['Цвета',item.colors.map(value=>COLORS[value][0]).join(', ')],['Теплота',WARMTH_OPTIONS[item.warmth]],['Защита от дождя',RAINPROOF_OPTIONS[item.rainproof]],['Дата покупки',item.purchaseDate ? new Date(`${item.purchaseDate}T12:00:00`).toLocaleDateString('ru-RU') : '']].filter(([,value])=>value);
  return <>
    <article className="item-card">
      <div className="item-image"><button className="item-image-link" type="button" onClick={()=>setDetails(true)} aria-label={`Открыть карточку: ${item.name}`}>{item.photo ? <img src={item.photo} alt={item.name} loading="lazy" /> : <ItemArt item={item} />}</button><button className={`icon-button favorite-button${item.favorite ? ' active' : ''}`} type="button" disabled={busy} aria-label={`${item.favorite ? 'Убрать из избранного' : 'В избранное'}: ${item.name}`} aria-pressed={item.favorite} onClick={()=>toggle('favorite')}><Icon name="heart" /></button>{!item.available && <span className="availability-badge">В стирке</span>}</div>
      <div className="card-body"><p className="eyebrow">{SUBCATEGORIES[item.category]?.[item.subcategory] || CATEGORIES[item.category]}</p><h3><button className="item-title-button" type="button" onClick={()=>setDetails(true)}>{item.name}</button></h3><div className="tag-row"><ColorDots colors={item.colors} /><span className="item-meta">{item.seasons.map(value=>SEASONS[value]).join(' · ')}</span></div>{(item.size || item.brand || item.style) && <p className="item-meta">{[item.size && `Размер ${item.size}`,item.brand,STYLE_OPTIONS[item.style] || item.style].filter(Boolean).join(' · ')}</p>}<div className="card-actions"><button className="button button-ghost" type="button" disabled={busy} onClick={edit}><Icon name="edit" />Изменить</button><button className="icon-button" type="button" disabled={busy} onClick={()=>toggle('available')} aria-label={`${item.available ? 'Отправить в стирку' : 'Вернуть из стирки'}: ${item.name}`} title={item.available ? 'Отправить в стирку' : 'Вернуть из стирки'}><Icon name={item.available ? 'sun' : 'check'} /></button></div>{error && <p className="form-error" role="alert">{error}</p>}</div>
    </article>
    {details && <Modal title={item.name} description={item.available ? 'Готова к выходу' : 'Сейчас в стирке'} onClose={()=>setDetails(false)}><div className="garment-details"><div className="garment-detail-image">{item.photo ? <img src={item.photo} alt={item.name} /> : <ItemArt item={item} />}</div><dl className="garment-detail-meta">{properties.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>{item.notes && <section className="garment-detail-notes"><h3>Моя заметка</h3><p>{item.notes}</p></section>}<div className="form-actions"><button className="button button-danger" type="button" onClick={()=>{setDetails(false);setConfirmDelete(true);}}><Icon name="trash" />Удалить</button><button className="button button-primary" type="button" onClick={edit}><Icon name="edit" />Изменить вещь</button></div></Modal>}
    {confirmDelete && <ConfirmDialog title="Удалить вещь?" description={`«${item.name}» будет удалена. Сохранённые образы останутся, но будут отмечены как неполные, если содержат эту вещь.`} onConfirm={remove} onClose={()=>{if(!busy)setConfirmDelete(false);}} />}
    {editing && <ItemForm item={item} onClose={()=>setEditing(false)} />}
  </>;
}
