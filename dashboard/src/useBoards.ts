import { useCallback, useEffect, useState } from 'react';

import { describeError, listBoards } from './api';
import type { BoardProfile } from './types';

export interface BoardCatalogState {
  boards: BoardProfile[];
  error: string | null;
  refresh: () => Promise<void>;
}

export function useBoards(): BoardCatalogState {
  const [boards, setBoards] = useState<BoardProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await listBoards();
      setBoards(next);
      setError(null);
    } catch (cause) {
      setError(describeError(cause, 'Board profiles could not be loaded'));
    }
  }, []);

  useEffect(() => {
    // Initial catalog load; refresh is also called manually by the retry button.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { boards, error, refresh };
}
