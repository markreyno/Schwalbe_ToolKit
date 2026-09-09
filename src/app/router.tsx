import { createRootRoute, createRoute, createRouter, createHashHistory, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Grid2X2, ArrowUpRight, Command } from 'lucide-react';
import { ToolHub } from '../pages/ToolHub';
import { CounterPage } from '../tools/counter/CounterPage';
import { PalletPage } from '../tools/pallet/PalletPage';
import { RafflePage } from '../tools/raffle/RafflePage';
import { AppUpdates } from '../components/AppUpdates';
import supersign from '../assets/schwalbe-supersign.png';
function Shell() {
  const pathname = useRouterState({ select: state => state.location.pathname });
  const isHome = useRouterState({ select: state => state.location.pathname === '/' });
  return <div className="app-shell"><aside className="sidebar"><Link to="/" className="brand" aria-label="Schwalbe ToolKit home"><img className="brand-logo" src={supersign} alt=""/><div>SCHWALBE<small>TOOLKIT</small></div></Link><div className="sidebar-section">WORKSPACE</div><Link to="/" className={`nav-item ${isHome ? 'selected' : ''}`}><Grid2X2 size={19}/> Tool hub <span>01</span></Link><div className="sidebar-bottom"><div className="mini-brand"><Command size={19}/><span>Your everyday workspace</span></div><AppUpdates/></div></aside><div className="main-shell"><div className="topbar"><div>Workspace <span>/</span> <strong>{isHome ? 'Tool hub' : pathname === '/tools/raffle' ? 'Uline Raffle' : pathname === '/tools/pallet' ? 'Pallet Label Printer' : 'Counter'}</strong></div><span className="local-badge"><span/> Local workspace</span></div><main><Outlet/></main><footer><span>MADE FOR A SMOOTHER WORKDAY</span><span>SCHWALBE <ArrowUpRight size={13}/></span></footer></div></div>;
}
const root = createRootRoute({ component: Shell, notFoundComponent: () => <><h1>Tool not found</h1><Link to="/">Return to the tool hub</Link></> });
const index = createRoute({ getParentRoute: () => root, path: '/', component: ToolHub });
const counter = createRoute({ getParentRoute: () => root, path: '/tools/counter', component: CounterPage });
const pallet = createRoute({ getParentRoute: () => root, path: '/tools/pallet', component: PalletPage });
const raffle = createRoute({ getParentRoute: () => root, path: '/tools/raffle', component: RafflePage });
export const router = createRouter({ routeTree: root.addChildren([index, counter, pallet, raffle]), history: createHashHistory() });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
