'use client';

import { useEffect, useRef, useState } from 'react';
import { alphaMask, encodeEditedPhoto, loadPhotoCanvas, paintAlpha, removeConnectedBackground, restoreAlphaMask, visiblePixelCount } from '../lib/photo-background.js';
import { AppButton } from './app-button.jsx';
import { Field, Icon, Modal } from './ui.jsx';

export default function PhotoEditor({ photo, onApply, onClose }) {
  const canvas = useRef(null), original = useRef(null), pixels = useRef(null), history = useRef([]), stroke = useRef(null), mounted = useRef(true);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [tool, setTool] = useState('background'), [tolerance, setTolerance] = useState(32), [brushSize, setBrushSize] = useState(64), [steps, setSteps] = useState(0), [visible, setVisible] = useState(0), [cursor, setCursor] = useState(null);

  useEffect(() => {
    let alive = true; mounted.current = true;
    loadPhotoCanvas(photo).then(source => {
      if (!alive || !canvas.current) return;
      const target = canvas.current; target.width = source.width; target.height = source.height;
      const context = target.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Браузер не поддерживает редактирование фото.');
      context.drawImage(source, 0, 0);
      original.current = context.getImageData(0, 0, target.width, target.height);
      pixels.current = context.getImageData(0, 0, target.width, target.height);
      setVisible(visiblePixelCount(pixels.current)); setReady(true);
    }).catch(cause => { if (alive) setError(cause.message || 'Не удалось открыть редактор.'); });
    return () => { alive = false; mounted.current = false; };
  }, [photo]);

  function draw() {
    canvas.current.getContext('2d').putImageData(pixels.current, 0, 0);
  }
  function remember(mask) {
    const maximum = Math.max(2, Math.min(12, Math.floor(20 * 1024 * 1024 / mask.length)));
    history.current.push(mask);
    if (history.current.length > maximum) history.current.shift();
    setSteps(history.current.length);
  }
  function updateStats() {
    const count = visiblePixelCount(pixels.current); setVisible(count);
    if (!count) setMessage('На фото ничего не осталось. Восстановите вещь или отмените шаг.');
    else if (count < pixels.current.width * pixels.current.height * .01) setMessage('Осталось мало изображения. Проверьте, что вещь не стёрта.');
  }
  async function remove(seed = null) {
    if (!ready || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!mounted.current) return;
      const result = removeConnectedBackground(pixels.current, { tolerance, seed });
      if (result.removed) {
        remember(alphaMask(pixels.current));
        pixels.current = new ImageData(result.data, result.width, result.height); draw();
        setMessage('Фон стал прозрачным. Проверьте края и при необходимости поправьте кистью.'); updateStats();
      } else setMessage(seed ? 'В этой точке нечего убирать. Выберите непрозрачный участок фона.' : 'Однотонный фон не найден по углам. Нажмите на нужный участок фона или используйте ластик.');
    } catch (cause) { if (mounted.current) setError(cause.message || 'Не удалось обработать фон.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  function point(event) {
    const bounds = canvas.current.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.current.width - 1, (event.clientX - bounds.left) * canvas.current.width / bounds.width)), y: Math.max(0, Math.min(canvas.current.height - 1, (event.clientY - bounds.top) * canvas.current.height / bounds.height)) };
  }
  function brush(position) {
    const previous = stroke.current.last || position;
    const distance = Math.hypot(position.x - previous.x, position.y - previous.y);
    const samples = Math.max(1, Math.ceil(distance / Math.max(2, brushSize / 5)));
    for (let sample = 1; sample <= samples; sample++) stroke.current.changed += paintAlpha(pixels.current, original.current, { x: previous.x + (position.x - previous.x) * sample / samples, y: previous.y + (position.y - previous.y) * sample / samples, radius: brushSize / 2, restore: tool === 'restore' });
    stroke.current.last = position; draw();
  }
  function start(event) {
    if (!ready || busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); canvas.current.focus({ preventScroll: true });
    const position = point(event); setCursor(position); setMessage('');
    if (tool === 'background') { void remove(position); return; }
    canvas.current.setPointerCapture(event.pointerId);
    stroke.current = { before: alphaMask(pixels.current), changed: 0, last: position };
    brush(position);
  }
  function move(event) {
    if (!ready || busy) return;
    const position = point(event); setCursor(position);
    if (stroke.current) { event.preventDefault(); brush(position); }
  }
  function finish(event, cancel = false) {
    if (!stroke.current) return;
    if (cancel) { restoreAlphaMask(pixels.current, stroke.current.before); draw(); }
    else if (stroke.current.changed) remember(stroke.current.before);
    stroke.current = null;
    if (canvas.current.hasPointerCapture(event.pointerId)) canvas.current.releasePointerCapture(event.pointerId);
    updateStats();
  }
  function keyDown(event) {
    if (!ready || busy) return;
    const position = cursor || { x: Math.floor(canvas.current.width / 2), y: Math.floor(canvas.current.height / 2) };
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (direction) {
      event.preventDefault(); const step = event.shiftKey ? 20 : 5;
      setCursor({ x: Math.max(0, Math.min(canvas.current.width - 1, position.x + direction[0] * step)), y: Math.max(0, Math.min(canvas.current.height - 1, position.y + direction[1] * step)) });
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); setMessage('');
      if (tool === 'background') void remove(position);
      else { stroke.current = { before: alphaMask(pixels.current), changed: 0, last: position }; brush(position); if (stroke.current.changed) remember(stroke.current.before); stroke.current = null; updateStats(); }
    }
  }
  function undo() {
    if (busy || !history.current.length) return;
    restoreAlphaMask(pixels.current, history.current.pop()); draw(); setSteps(history.current.length); setMessage('Предыдущий шаг отменён.'); updateStats();
  }
  function reset() {
    if (busy || !ready) return;
    remember(alphaMask(pixels.current)); restoreAlphaMask(pixels.current, alphaMask(original.current)); draw(); setMessage('Исходная фотография восстановлена.'); updateStats();
  }
  async function apply() {
    if (!ready || busy || !visible) return;
    setBusy(true); setError('');
    try { const result = encodeEditedPhoto(canvas.current); await onApply(result); }
    catch (cause) { if (mounted.current) setError(cause.message || 'Не удалось применить изменения.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <Modal title="Фотография вещи" description="Уберите однотонный фон и поправьте края. Фото обрабатывается только в вашем браузере." onClose={busy ? () => {} : onClose}>
    <div className="photo-editor" aria-busy={busy}>
      <p className="photo-editor-note">Для сложного фона используйте ластик. Автоматический инструмент сравнивает цвет фона, а не распознаёт одежду.</p>
      <div className="photo-editor-stage"><div className="photo-canvas-wrap">
        <canvas ref={canvas} className="photo-editor-canvas" data-testid="photo-editor-canvas" tabIndex={ready ? 0 : -1} role="img" aria-label="Редактор фото. Стрелки перемещают кисть, пробел применяет выбранный инструмент." onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onPointerLeave={() => { if (!stroke.current) setCursor(null); }} onKeyDown={keyDown}/>
        {ready && cursor && <span className={`photo-brush-cursor${tool === 'background' ? ' is-point' : ''}`} aria-hidden="true" style={{ left: `${cursor.x / canvas.current.width * 100}%`, top: `${cursor.y / canvas.current.height * 100}%`, width: tool === 'background' ? 14 : `${brushSize / canvas.current.width * 100}%` }} />}
      </div></div>
      {!ready && !error && <p role="status">Открываем фотографию…</p>}
      <div className="photo-editor-tools" role="group" aria-label="Инструменты фотографии">
        <AppButton type="button" className="btn btn-secondary" disabled={!ready || busy} onClick={() => remove()}><Icon name="image"/>Убрать однотонный фон</AppButton>
        <div className="photo-tool-choices">{[['background', 'Убрать по нажатию'], ['erase', 'Ластик'], ['restore', 'Восстановить']].map(([value, label]) => <AppButton type="button" key={value} data-photo-tool={value} className={`btn btn-ghost${tool === value ? ' is-active' : ''}`} aria-pressed={tool === value} disabled={!ready || busy} onClick={() => setTool(value)}>{label}</AppButton>)}</div>
        <div className="photo-editor-sliders"><Field label={`Допуск цвета: ${tolerance}`}><input type="range" min="0" max="120" value={tolerance} disabled={!ready || busy} onChange={event => setTolerance(Number(event.target.value))}/></Field><Field label={`Размер кисти: ${brushSize}`}><input type="range" min="6" max="200" value={brushSize} disabled={!ready || busy} onChange={event => setBrushSize(Number(event.target.value))}/></Field></div>
        <div className="photo-editor-history"><AppButton type="button" className="btn btn-ghost" disabled={!steps || busy} onClick={undo}><Icon name="refresh"/>Отменить шаг</AppButton><AppButton type="button" className="btn btn-ghost" disabled={!ready || busy} onClick={reset}>Вернуть исходное</AppButton></div>
      </div>
      <p className="photo-editor-hint">Нажмите на фон, чтобы убрать связанный участок. Для точной правки проведите кистью; с клавиатуры — стрелки и пробел. Прозрачность показана клетками. Фото уменьшается до 1200 пикселей по длинной стороне.</p>
      {busy && <p role="status">Обрабатываем фотографию…</p>}{message && <p className={`notice${!visible && ready ? ' notice-error' : ''}`} role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><AppButton type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Отмена</AppButton><AppButton type="button" className="btn btn-primary" disabled={!ready || busy || !visible} onClick={apply}><Icon name="check"/>Применить</AppButton></div>
      <p className="photo-editor-note">Применение изменит только черновик. Чтобы сохранить фото в гардероб, затем нажмите «Сохранить вещь».</p>
    </div>
  </Modal>;
}
