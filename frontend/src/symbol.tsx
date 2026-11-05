import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@augur/app-kit';
import type { TypeDef } from './api.js';

/**
 * Military symbols for kinds (ADR 0070). A kind may carry an APP-6 or
 * MIL-STD-2525 code; milsymbol draws it. milsymbol is large, so it's loaded
 * only when a kind on screen has a code, and only once. Each symbol is an
 * image from a data URL, never markup put into the page, drawn in the
 * standard's own colours because they say whose it is.
 */
type Milsymbol = typeof import('milsymbol');
let loading: Promise<Milsymbol> | undefined;
const milsymbol = () =>
  (loading ??= import('milsymbol').then((m) => ((m as unknown as { default?: Milsymbol }).default ?? m) as Milsymbol).catch((err: unknown) => {
    loading = undefined;
    throw err;
  }));

/** The symbol for a code, as an image URL, or undefined when milsymbol can't draw it. */
export const drawSymbol = async (code: string, size: number): Promise<string | undefined> => {
  const ms = await milsymbol();
  const symbol = new ms.Symbol(code, { size });
  return symbol.isValid() ? symbol.toDataURL() : undefined;
};

/** Why a code won't do, in words; undefined when it can be drawn. */
export const symbolProblem = async (code: string): Promise<string | undefined> => {
  try {
    return (await drawSymbol(code, 24)) ? undefined : `“${code}” isn’t a symbol code that can be drawn. Check it against APP-6 or MIL-STD-2525, or leave it empty to keep the icon.`;
  } catch {
    return 'Symbols can’t be drawn right now, so the code can’t be checked. Try again, or leave it empty to keep the icon.';
  }
};

/** A kind's symbol image, once drawn; undefined until then, and for a kind with none or one that can't be drawn. */
export const useSymbol = (code: string | undefined, size: number) => {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    setUrl(undefined);
    if (code)
      drawSymbol(code, size)
        .then((drawn) => live && setUrl(drawn))
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code, size]);
  return url;
};

export interface KindMarkProps {
  kind: Pick<TypeDef, 'icon' | 'label' | 'symbol'> | undefined;
  /** Its height in CSS pixels, as the icon would be. */
  size?: number;
}

/** A kind's mark: its military symbol where it has one that can be drawn, else its icon. Its name sits beside it, so the image says nothing more. */
export function KindMark({ kind, size = 16 }: KindMarkProps) {
  const url = useSymbol(kind?.symbol, size);
  if (url) return <img className="atlas-symbol" src={url} alt="" height={size} data-symbol={kind?.symbol} />;
  return <Icon name={(kind?.icon ?? 'atlas') as IconName} size={size} />;
}

/** The kind's symbol, large, on an entity's page; nothing when its kind has none that can be drawn. */
export function KindSymbol({ kind }: { kind: Pick<TypeDef, 'label' | 'symbol'> | undefined }) {
  const url = useSymbol(kind?.symbol, 48);
  if (!url || !kind) return null;
  return (
    <figure className="atlas-kind-symbol">
      <img src={url} alt={`The military symbol for ${kind.label}`} height={48} />
      <figcaption className="atlas-note">{`${kind.label} · ${kind.symbol}`}</figcaption>
    </figure>
  );
}
