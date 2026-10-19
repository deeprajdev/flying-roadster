const ROWS: [string[], string][] = [
  [['W', '↑'], 'Accelerate'],
  [['S', '↓'], 'Brake / reverse'],
  [['A', 'D'], 'Steer'],
  [['Shift'], 'Rocket boost'],
  [['Space'], 'Drift · flip in the air'],
  [['F'], 'Fly: tap to hop, hold to hover'],
  [['C'], 'Camera'],
  [['R'], 'Reset car'],
  [['Esc'], 'Pause'],
];

const TOUCH_ROWS: [string[], string][] = [
  [['◀', '▶'], 'Steer: tap or hold, slide to switch'],
  [['Boost'], 'Rocket boost'],
  [['Fly'], 'Tap to hop, hold to hover'],
  [['Drift'], 'Drift · becomes Flip in the air'],
  [['Brake'], 'Brake / reverse'],
  [['Auto'], 'The car accelerates by itself'],
  [['❚❚'], 'Pause'],
];

export function Controls({ touch = false }: { touch?: boolean }) {
  return (
    <dl className="controls">
      {(touch ? TOUCH_ROWS : ROWS).map(([keys, label]) => (
        <div key={label} className="ctl">
          <dt>
            {keys.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  );
}
