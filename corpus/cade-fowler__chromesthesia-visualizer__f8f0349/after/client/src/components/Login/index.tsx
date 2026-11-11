import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useOwner } from '../../auth/OwnerContext';
import { safeNext } from '../../auth/next';
import { login, TooManyAttemptsError } from '../databaseAPI';
import { primaryKeyClass } from '../ui/buttons';
import { fieldLabelClass, inputClass } from '../ui/fields';

/** The owner's login. Nothing links here; the owner types the address. */
const Login = () => {
    const { owner, setOwner } = useOwner();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const next = safeNext(searchParams.get('next'));
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    if (owner) return <Navigate to={next} replace />;

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            if (await login(password)) {
                setOwner(true);
                navigate(next, { replace: true });
                return;
            }
            setError('Wrong password.');
            setPassword('');
        } catch (err) {
            if (err instanceof TooManyAttemptsError) {
                const minutes = Math.max(1, Math.ceil(err.retryAfterSeconds / 60));
                setError(
                    `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
                );
            } else {
                setError(err instanceof Error ? err.message : 'Logging in failed.');
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-full items-center justify-center p-6 lg:h-full">
            <form
                onSubmit={handleSubmit}
                className="flex w-full max-w-sm flex-col gap-4 panel screws p-8"
            >
                <h1 className="text-[11px] silk">Owner login</h1>
                <label className="flex flex-col gap-1.5">
                    <span className={fieldLabelClass}>Password</span>
                    <input
                        type="password"
                        autoComplete="current-password"
                        autoFocus
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className={inputClass}
                        aria-invalid={error !== null}
                        aria-describedby={error ? 'login-error' : undefined}
                    />
                </label>
                {error && (
                    <p id="login-error" role="alert" className="text-sm text-danger">
                        {error}
                    </p>
                )}
                <button type="submit" disabled={busy || !password} className={primaryKeyClass}>
                    {busy ? 'Logging in…' : 'Log in'}
                </button>
            </form>
        </div>
    );
};

export default Login;
