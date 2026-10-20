/* eslint-disable react-refresh/only-export-components -- a test helper, never hot-reloaded */
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import type { InitialEntry } from 'react-router-dom';
import { AuthPage } from '../AuthPage';

/** Where the reader landed after signing in. */
function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{`${location.pathname}${location.search}${location.hash}`}</p>;
}

/** The address under the auth page, and how the router last got there (PUSH, REPLACE, POP). */
function Address() {
  const location = useLocation();
  return <output data-testid="address" data-navigation={useNavigationType()}>{location.pathname}</output>;
}

/** The auth page as `App.tsx` mounts it: one parent route over `/login` and `/register`. */
export function renderAuth(entry: InitialEntry = '/login', initialEntries: InitialEntry[] = []) {
  const tree = () => (
    <MemoryRouter initialEntries={[...initialEntries, entry]} initialIndex={initialEntries.length}>
      <Routes>
        <Route
          element={
            <>
              <AuthPage />
              <Address />
            </>
          }
        >
          <Route path="/login" element={null} />
          <Route path="/register" element={null} />
        </Route>
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>
  );
  const result = render(tree());
  /** Render the same tree again, as a change in a mocked hook would. */
  return { ...result, rerenderSame: () => result.rerender(tree()) };
}
