import { createRootRoute, createRoute, createRouter, createHashHistory, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Grid2X2, ArrowUpRight, Command, Forklift } from 'lucide-react';
import { ToolHub } from '../pages/ToolHub';
import { CounterPage } from '../tools/counter/CounterPage';
import { PalletPage } from '../tools/pallet/PalletPage';
import { RafflePage } from '../tools/raffle/RafflePage';
import { AppUpdates } from '../components/AppUpdates';
import { PickerWaterPage } from '../tools/pickerWater/PickerWaterPage';
import { duePickers, usePickers, useToday } from '../tools/pickerWater/store';
import supersign from '../assets/schwalbe-supersign.png';
function Shell() {
  const dueCount = duePickers(usePickers(), useToday()).length;
  const pathname = useRouterState({ select: state => state.location.pathname });
  const isHome = useRouterState({ select: state => state.location.pathname === '/' });
  return <div className="app-shell"><aside className="sidebar"><Link to="/" className="brand" aria-label="Schwalbe ToolKit home"><img className="brand-logo" src={supersign} alt=""/><div>SCHWALBE<small>TOOLKIT</small></div></Link><div className="sidebar-section">WORKSPACE</div><Link to="/" className={`nav-item ${isHome ? 'selected' : ''}`}><Grid2X2 size={19}/> Tool hub <span>01</span></Link><div className="sidebar-bottom"><div className="mini-brand"><Command size={19}/><span>Your everyday workspace</span></div><AppUpdates/></div></aside><div className="main-shell"><div className="topbar"><div>Workspace <span>/</span> <strong>{isHome ? 'Tool hub' : pathname === '/tools/raffle' ? 'Uline Raffle' : pathname === '/tools/pallet' ? 'Pallet Label Printer' : pathname === '/tools/picker-water' ? 'Picker Water Scheduler' : 'Counter'}</strong></div><span className="local-badge"><span/> Local workspace</span></div>{dueCount > 0 && isHome && <Link to="/tools/picker-water" className="global-water-banner" role="status"><Forklift size={17}/><span>{dueCount} picker{dueCount === 1 ? '' : 's'} need{dueCount === 1 ? 's' : ''} water</span><strong>View schedule →</strong></Link>}<main><Outlet/></main><footer><span>MADE FOR A SMOOTHER WORKDAY</span><span>SCHWALBE <ArrowUpRight size={13}/></span></footer></div></div>;
}
const root = createRootRoute({ component: Shell, notFoundComponent: () => <><h1>Tool not found</h1><Link to="/">Return to the tool hub</Link></> });
const index = createRoute({ getParentRoute: () => root, path: '/', component: ToolHub });
const counter = createRoute({ getParentRoute: () => root, path: '/tools/counter', component: CounterPage });
const pallet = createRoute({ getParentRoute: () => root, path: '/tools/pallet', component: PalletPage });
const raffle = createRoute({ getParentRoute: () => root, path: '/tools/raffle', component: RafflePage });
const pickerWater = createRoute({ getParentRoute: () => root, path: '/tools/picker-water', component: PickerWaterPage });
export const router = createRouter({ routeTree: root.addChildren([index, counter, pallet, raffle, pickerWater]), history: createHashHistory() });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
