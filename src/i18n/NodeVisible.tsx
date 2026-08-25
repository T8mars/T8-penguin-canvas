import type { ReactNode } from 'react';
import LocalizedVisibleTree from './LocalizedVisibleTree';
import { localizeNodeDynamicText, NODE_VISIBLE_CATALOG } from './nodeVisibleCatalog';

export default function NodeVisible({ children }: { children: ReactNode }) {
  return (
    <LocalizedVisibleTree
      area="nodes"
      catalog={NODE_VISIBLE_CATALOG}
      dynamicLocalizer={localizeNodeDynamicText}
    >
      {children}
    </LocalizedVisibleTree>
  );
}
