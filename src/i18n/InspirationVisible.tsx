import type { ReactNode } from 'react';
import LocalizedVisibleTree from './LocalizedVisibleTree';
import { INSPIRATION_VISIBLE_CATALOG } from './inspirationVisibleCatalog';

export default function InspirationVisible({ children }: { children: ReactNode }) {
  return (
    <LocalizedVisibleTree area="inspiration" catalog={INSPIRATION_VISIBLE_CATALOG}>
      {children}
    </LocalizedVisibleTree>
  );
}
