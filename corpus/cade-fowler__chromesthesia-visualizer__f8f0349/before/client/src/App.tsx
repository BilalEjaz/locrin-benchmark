import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import ColorPicker from './components/ColorPicker';
import Explore from './components/Explore';
import SongPage from './components/SongPage';
import NotFound from './components/NotFound';

/**
 * Spotify's login redirect goes to the site's origin (the registered redirect URI), which is
 * Explore. Send it on to the Studio, which finishes logging in.
 */
const Home = () => {
    const { search } = useLocation();
    const params = new URLSearchParams(search);
    if (params.has('code') || params.has('error')) {
        return <Navigate to={{ pathname: '/studio', search }} replace />;
    }
    return <Explore />;
};

function App() {
    return (
        <Routes>
            <Route path="/" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="studio" element={<ColorPicker />} />
                <Route path="songs/:songId" element={<SongPage />} />
                <Route path="*" element={<NotFound />} />
            </Route>
        </Routes>
    );
}

export default App;
