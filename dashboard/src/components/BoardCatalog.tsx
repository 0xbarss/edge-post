import {
  formatAdcChannel,
  formatClock,
  formatGpioList,
  formatI2c,
  formatSpi,
  formatUart,
} from '../board-format';
import type { BoardProfile } from '../types';

interface BoardCatalogProps {
  boards: BoardProfile[];
  error: string | null;
  onRefresh: () => Promise<void>;
}

interface RoleRowProps {
  label: string;
  values: string[];
}

function RoleRow({ label, values }: RoleRowProps) {
  if (values.length === 0) {
    return null;
  }

  return (
    <div className="board-card__role">
      <dt>{label}</dt>
      <dd>{values.join(' · ')}</dd>
    </div>
  );
}

function BoardCard({ board }: { board: BoardProfile }) {
  return (
    <article className="board-card">
      <header className="board-card__header">
        <div>
          <h3 className="board-card__name">{board.name}</h3>
          <p className="board-card__mcu mono">{board.mcu.name}</p>
          {board.mcu.cpn !== null && <p className="board-card__cpn mono">{board.mcu.cpn}</p>}
        </div>
        <span className="board-card__family mono">{board.mcu.family ?? 'STM32'}</span>
      </header>

      <dl className="board-card__specs">
        <div>
          <dt>Package</dt>
          <dd>{board.mcu.package ?? '—'}</dd>
        </div>
        <div>
          <dt>Clock</dt>
          <dd className="mono">{formatClock(board.clock.sysclkHz)}</dd>
        </div>
        <div>
          <dt>Pins</dt>
          <dd className="mono">{board.pins.length}</dd>
        </div>
        <div>
          <dt>Outputs</dt>
          <dd className="mono">{board.groups.outputs.length}</dd>
        </div>
      </dl>

      <dl className="board-card__roles">
        <RoleRow label="ADC" values={board.groups.adc.map(formatAdcChannel)} />
        <RoleRow label="UART" values={board.groups.uart.map(formatUart)} />
        <RoleRow label="SPI" values={board.groups.spi.map(formatSpi)} />
        <RoleRow label="I2C" values={board.groups.i2c.map(formatI2c)} />
        <RoleRow
          label="Outputs"
          values={board.groups.outputs.length === 0 ? [] : [formatGpioList(board.groups.outputs)]}
        />
        <RoleRow
          label="Inputs"
          values={board.groups.inputs.length === 0 ? [] : [formatGpioList(board.groups.inputs)]}
        />
      </dl>

      <div className="board-card__peripherals">
        {board.peripherals.map((peripheral) => (
          <span key={peripheral} className="board-chip mono">
            {peripheral}
          </span>
        ))}
      </div>

      {board.pins.length > 0 && (
        <details className="board-card__details">
          <summary>
            Pin map <span className="mono">{board.pins.length}</span>
          </summary>
          <ul className="board-pin-list">
            {board.pins.map((pin) => (
              <li key={pin.pin}>
                <span className="board-pin-list__pin mono">{pin.pin}</span>
                <span className="board-pin-list__signal mono">{pin.signal}</span>
                <span className="board-pin-list__label">{pin.label ?? '—'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="board-card__source mono">{board.source}</p>
    </article>
  );
}

export function BoardCatalog({ boards, error, onRefresh }: BoardCatalogProps) {
  return (
    <section className="panel board-catalog" aria-labelledby="boards-title">
      <div className="panel-heading">
        <div>
          <span className="panel-eyebrow">Hardware Targets</span>
          <h2 id="boards-title" className="panel-title">
            Board Profiles
          </h2>
          <p className="panel-sub">CubeMX projects available to the firmware build</p>
        </div>
        <span className="panel-count mono">{boards.length} profiles</span>
      </div>

      {error !== null ? (
        <div className="board-catalog__empty" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              void onRefresh();
            }}
          >
            Retry
          </button>
        </div>
      ) : boards.length === 0 ? (
        <div className="board-catalog__empty">
          <p>
            No board profiles published. Add a CubeMX project under{' '}
            <code>firmware/boards/&lt;board&gt;/</code> and run <code>make board</code>.
          </p>
        </div>
      ) : (
        <div className="board-grid">
          {boards.map((board) => (
            <BoardCard key={board.name} board={board} />
          ))}
        </div>
      )}
    </section>
  );
}
