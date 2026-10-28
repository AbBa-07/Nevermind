'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';

const CONTRACT_ABI = [
  'function getCandidates() view returns (tuple(uint256 id, string name, uint256 voteCount)[])',
];
const AMOY_CHAIN_ID = BigInt(80002);
const POLL_INTERVAL_MS = 8_000;

type Candidate = {
  id: number;
  name: string;
  voteCount: string;
};

type ApiResponse = {
  error?: string;
  message?: string;
  tokenHash?: string;
  success?: boolean;
  pending?: boolean;
  txHash?: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function readApiResponse(response: Response): Promise<ApiResponse> {
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    throw new Error(`The API returned an invalid response (${response.status}).`);
  }
  return payload as ApiResponse;
}

function Icon({
  name,
  className = 'h-5 w-5',
}: {
  name: 'shield' | 'arrow' | 'refresh' | 'check' | 'lock' | 'vote';
  className?: string;
}) {
  const paths = {
    shield: (
      <>
        <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    arrow: (
      <>
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M4 17v-5h5" />
        <path d="M5.6 9a7 7 0 0 1 11.55-2.6L20 12M4 12l2.85 5.6A7 7 0 0 0 18.4 15" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    lock: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
    vote: (
      <>
        <path d="M9 12 11 14 15 10" />
        <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

export default function Home() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '');
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

  const [studentId, setStudentId] = useState('');
  const [tokenHash, setTokenHash] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [transactionHash, setTransactionHash] = useState('');
  const [tallyError, setTallyError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const provider = useMemo(() => {
    if (!rpcUrl || !rpcUrl.startsWith('https://')) return null;
    return new ethers.JsonRpcProvider(rpcUrl, Number(AMOY_CHAIN_ID), {
      staticNetwork: true,
    });
  }, [rpcUrl]);

  const contract = useMemo(() => {
    if (!provider || !contractAddress || !ethers.isAddress(contractAddress)) {
      return null;
    }
    return new ethers.Contract(contractAddress, CONTRACT_ABI, provider);
  }, [provider, contractAddress]);

  const refreshTally = useCallback(async () => {
    if (!contract) {
      setTallyError(
        !rpcUrl
          ? 'Set NEXT_PUBLIC_RPC_URL to connect to Polygon Amoy.'
          : !contractAddress || !ethers.isAddress(contractAddress)
            ? 'Set NEXT_PUBLIC_CONTRACT_ADDRESS to a valid deployed contract address.'
            : 'Set a valid Polygon Amoy RPC URL.',
      );
      return;
    }

    setIsRefreshing(true);
    try {
      const results: unknown = await contract.getCandidates();
      if (!Array.isArray(results)) {
        throw new Error('The contract returned an invalid candidate list.');
      }
      const parsed = results.map((candidate: unknown): Candidate => {
        if (
          typeof candidate !== 'object' ||
          candidate === null ||
          !('id' in candidate) ||
          !('name' in candidate) ||
          !('voteCount' in candidate)
        ) {
          throw new Error('The contract returned an invalid candidate.');
        }
        const id = Number(candidate.id);
        if (!Number.isSafeInteger(id)) {
          throw new Error('The contract returned an invalid candidate ID.');
        }
        if (typeof candidate.name !== 'string') {
          throw new Error('The contract returned an invalid candidate name.');
        }
        const voteCount = candidate.voteCount;
        if (
          typeof voteCount !== 'bigint' &&
          typeof voteCount !== 'number' &&
          typeof voteCount !== 'string'
        ) {
          throw new Error('The contract returned an invalid vote count.');
        }
        return {
          id,
          name: candidate.name,
          voteCount: voteCount.toString(),
        };
      });
      setCandidates(parsed);
      setTallyError('');
      setLastUpdated(new Date());
    } catch (error) {
      setTallyError(errorMessage(error, 'Unable to load the live tally.'));
    } finally {
      setIsRefreshing(false);
    }
  }, [contract, rpcUrl, contractAddress]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshTally(), 0);
    const timer = window.setInterval(() => void refreshTally(), POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
    };
  }, [refreshTally]);

  async function handleAuthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    if (!apiBaseUrl) {
      setMessage('Set NEXT_PUBLIC_API_URL to connect to the voting API.');
      return;
    }

    setIsAuthenticating(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: studentId.trim() }),
      });
      const data = await readApiResponse(response);
      if (!response.ok) {
        throw new Error(data.error ?? 'Authentication failed.');
      }
      if (!data.tokenHash || !/^0x[0-9a-fA-F]{64}$/.test(data.tokenHash)) {
        throw new Error('The API response did not contain a valid voting credential.');
      }

      setTokenHash(data.tokenHash);
      setIsAuthenticated(true);
      setMessage(data.message ?? 'Identity verified. Your voting credential is ready.');
    } catch (error) {
      setMessage(errorMessage(error, 'Unable to authenticate right now.'));
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleVote() {
    if (!apiBaseUrl || !tokenHash || selectedCandidate === null) {
      setMessage('Authenticate and select a candidate before submitting your vote.');
      return;
    }

    setIsSubmittingVote(true);
    setMessage('Submitting your vote through the secure relayer…');
    try {
      const response = await fetch(`${apiBaseUrl}/api/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenHash, candidateId: selectedCandidate }),
      });
      const data = await readApiResponse(response);
      if (!response.ok && response.status !== 202) {
        throw new Error(data.error ?? 'Vote submission failed.');
      }

      if (data.txHash) setTransactionHash(data.txHash);
      if (data.pending || response.status === 202) {
        setMessage(
          data.message ??
            'Your transaction is pending. You can safely check again using the same credential.',
        );
        return;
      }
      if (!response.ok || data.success !== true) {
        throw new Error(data.error ?? 'The API could not confirm your vote.');
      }

      setHasVoted(true);
      setMessage(data.message ?? 'Your vote has been recorded on-chain.');
      await refreshTally();
    } catch (error) {
      setMessage(errorMessage(error, 'Unable to submit your vote right now.'));
    } finally {
      setIsSubmittingVote(false);
    }
  }

  const totalVotes = candidates.reduce(
    (total, candidate) => total + BigInt(candidate.voteCount),
    BigInt(0),
  );
  const canRetryPending = Boolean(tokenHash && selectedCandidate !== null && !hasVoted);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f6f7f4] text-slate-900">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-48 h-[32rem] w-[32rem] rounded-full bg-emerald-200/35 blur-3xl" />
        <div className="absolute -right-48 top-1/4 h-[34rem] w-[34rem] rounded-full bg-sky-100/70 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-amber-100/40 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 sm:px-8">
        <header className="flex items-center justify-between border-b border-slate-200/80 py-5">
          <a className="flex items-center gap-3" href="#" aria-label="CivicFlow home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950 text-emerald-50 shadow-sm">
              <Icon name="vote" className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-base font-bold tracking-tight">CivicFlow</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.19em] text-slate-500">
                Institutional ballot
              </span>
            </span>
          </a>
          <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-2 text-xs font-semibold text-emerald-900 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Polygon Amoy
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[0.93fr_1.07fr] lg:gap-16 lg:py-16">
          <div className="mx-auto w-full max-w-xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/75 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
              <Icon name="shield" className="h-4 w-4 text-emerald-700" />
              Private credentials. Verifiable results.
            </div>
            <h1 className="max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-slate-950 sm:text-5xl lg:text-[3.6rem]">
              Your voice,
              <br />
              <span className="font-serif font-normal italic text-emerald-800">
                counted with care.
              </span>
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-slate-600 sm:text-base">
              Cast your institutional ballot through a one-time credential and follow the
              public tally directly on the Polygon Amoy blockchain.
            </p>

            <div className="mt-9 overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-[0_24px_80px_-45px_rgba(15,23,42,0.28)]">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 sm:px-7">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Ballot access
                  </p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
                    {hasVoted ? 'Your vote is in' : isAuthenticated ? 'Choose your candidate' : 'Verify your identity'}
                  </h2>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">
                  {hasVoted ? 'Complete' : isAuthenticated ? 'Step 2 of 2' : 'Step 1 of 2'}
                </span>
              </div>

              <div className="p-6 sm:p-7">
                {!isAuthenticated ? (
                  <form className="space-y-5" onSubmit={handleAuthenticate}>
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-800">
                        Student ID
                      </span>
                      <input
                        autoComplete="username"
                        className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-700/10"
                        maxLength={256}
                        onChange={(event) => setStudentId(event.target.value)}
                        placeholder="Enter your institutional ID"
                        required
                        value={studentId}
                      />
                    </label>
                    <button
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-950 px-5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/10 transition hover:bg-emerald-900 focus:outline-none focus:ring-4 focus:ring-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={isAuthenticating || !studentId.trim()}
                      type="submit"
                    >
                      {isAuthenticating ? 'Verifying identity…' : 'Verify & get ballot access'}
                      {!isAuthenticating && <Icon name="arrow" className="h-4 w-4" />}
                    </button>
                    <p className="flex items-start gap-2 text-xs leading-5 text-slate-500">
                      <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                      Your credential is one-time use. Keep it private and don’t share it.
                    </p>
                  </form>
                ) : hasVoted ? (
                  <div className="py-5 text-center">
                    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
                      <Icon name="check" className="h-7 w-7" />
                    </span>
                    <h3 className="mt-4 text-lg font-semibold text-slate-900">Ballot recorded</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Your transaction is confirmed on-chain. Thank you for participating.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {candidates.length === 0 && (
                      <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        Candidate list is unavailable until the contract tally loads.
                      </p>
                    )}
                    {candidates.map((candidate) => {
                      const selected = selectedCandidate === candidate.id;
                      return (
                        <button
                          aria-pressed={selected}
                          className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-4 focus:ring-emerald-700/10 ${
                            selected
                              ? 'border-emerald-800 bg-emerald-50/80 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                          }`}
                          key={candidate.id}
                          onClick={() => setSelectedCandidate(candidate.id)}
                          type="button"
                        >
                          <span className="flex items-center gap-3">
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                                selected
                                  ? 'border-emerald-800 bg-emerald-800 text-white'
                                  : 'border-slate-300 bg-white'
                              }`}
                            >
                              {selected && <Icon name="check" className="h-3.5 w-3.5" />}
                            </span>
                            <span>
                              <span className="block text-sm font-semibold text-slate-900">
                                {candidate.name}
                              </span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                Candidate #{candidate.id}
                              </span>
                            </span>
                          </span>
                          <span className="text-xs font-medium text-slate-400">
                            {candidate.voteCount} votes
                          </span>
                        </button>
                      );
                    })}
                    <button
                      className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-950 px-5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/10 transition hover:bg-emerald-900 focus:outline-none focus:ring-4 focus:ring-emerald-700/20 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        isSubmittingVote ||
                        !canRetryPending ||
                        candidates.length === 0
                      }
                      onClick={() => void handleVote()}
                      type="button"
                    >
                      {isSubmittingVote
                        ? 'Sending vote…'
                        : transactionHash
                          ? 'Check transaction status'
                          : 'Submit my vote'}
                      {!isSubmittingVote && <Icon name="arrow" className="h-4 w-4" />}
                    </button>
                    <p className="pt-1 text-center text-xs leading-5 text-slate-500">
                      Your ballot credential is never sent to the public tally page.
                    </p>
                  </div>
                )}

                {message && (
                  <div
                    aria-live="polite"
                    className={`mt-5 rounded-xl px-4 py-3 text-sm leading-6 ${
                      hasVoted
                        ? 'bg-emerald-50 text-emerald-900'
                        : message.toLowerCase().includes('pending') ||
                            message.toLowerCase().includes('awaiting')
                          ? 'bg-amber-50 text-amber-900'
                          : 'bg-slate-50 text-slate-700'
                    }`}
                  >
                    {message}
                  </div>
                )}
                {transactionHash && (
                  <a
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950"
                    href={`https://amoy.polygonscan.com/tx/${transactionHash}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View transaction on PolygonScan
                    <Icon name="arrow" className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
            <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">
              Testnet demonstration only. Do not use for binding elections or sensitive ballots.
            </p>
          </div>

          <aside className="mx-auto w-full max-w-2xl">
            <div className="overflow-hidden rounded-[2rem] border border-slate-800 bg-[#101c1a] text-white shadow-[0_30px_100px_-40px_rgba(15,23,42,0.6)]">
              <div className="relative overflow-hidden px-6 pb-8 pt-7 sm:px-9 sm:pb-10 sm:pt-9">
                <div
                  aria-hidden="true"
                  className="absolute -right-24 -top-24 h-72 w-72 rounded-full border border-emerald-200/10"
                />
                <div
                  aria-hidden="true"
                  className="absolute -right-12 -top-12 h-48 w-48 rounded-full border border-emerald-200/10"
                />
                <div className="relative flex items-start justify-between gap-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200/60">
                      On-chain overview
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                      Live tally
                    </h2>
                    <p className="mt-2 text-sm text-emerald-50/55">
                      Read directly from the voting contract
                    </p>
                  </div>
                  <button
                    aria-label="Refresh live tally"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-emerald-100 transition hover:bg-white/10 disabled:opacity-50"
                    disabled={isRefreshing}
                    onClick={() => void refreshTally()}
                    type="button"
                  >
                    <Icon
                      name="refresh"
                      className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>

                <div className="relative mt-7 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] p-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-emerald-50/45">
                      Ballots cast
                    </p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
                      {totalVotes.toString()}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] p-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-emerald-50/45">
                      Candidates
                    </p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
                      {candidates.length}
                    </p>
                  </div>
                </div>

                <div className="relative mt-8">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white/90">Current standings</h3>
                    <span className="flex items-center gap-2 text-[11px] text-emerald-100/50">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          tallyError ? 'bg-amber-400' : 'bg-emerald-400'
                        }`}
                      />
                      {tallyError ? 'Connection issue' : 'Auto-updating'}
                    </span>
                  </div>

                  {candidates.length > 0 ? (
                    <div className="space-y-4">
                      {candidates.map((candidate) => {
                        const count = BigInt(candidate.voteCount);
                        const percent =
                          totalVotes === BigInt(0)
                            ? 0
                            : Number((count * BigInt(10_000)) / totalVotes) / 100;
                        return (
                          <div key={candidate.id}>
                            <div className="mb-2 flex items-baseline justify-between gap-4">
                              <span className="truncate text-sm font-medium text-emerald-50/90">
                                {candidate.name}
                              </span>
                              <span className="shrink-0 text-xs tabular-nums text-emerald-50/55">
                                {candidate.voteCount}{' '}
                                {candidate.voteCount === '1' ? 'vote' : 'votes'}
                              </span>
                            </div>
                            <div
                              aria-label={`${candidate.name}: ${percent}%`}
                              className="h-2 overflow-hidden rounded-full bg-white/10"
                              role="progressbar"
                              aria-valuemax={100}
                              aria-valuemin={0}
                              aria-valuenow={percent}
                            >
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-200 transition-[width] duration-700"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/15 px-5 py-8 text-center">
                      <Icon name="vote" className="mx-auto h-6 w-6 text-emerald-200/60" />
                      <p className="mt-3 text-sm font-medium text-white/80">
                        {isRefreshing ? 'Loading on-chain results…' : 'Tally not available'}
                      </p>
                      {tallyError && (
                        <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-amber-100/70">
                          {tallyError}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {tallyError && candidates.length > 0 && (
                  <p className="relative mt-4 text-xs text-amber-100/70">{tallyError}</p>
                )}

                <div className="relative mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-[11px] text-emerald-50/45">
                  <span className="inline-flex items-center gap-2">
                    <Icon name="lock" className="h-3.5 w-3.5" />
                    Polygon Amoy · Chain ID 80002
                  </span>
                  <span>
                    {lastUpdated
                      ? `Updated ${lastUpdated.toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}`
                      : `Refreshes every ${POLL_INTERVAL_MS / 1000}s`}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-start gap-3 px-2 text-xs leading-5 text-slate-500">
              <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800" />
              <p>
                Results are queried from the public contract. The tally is transparent; it does
                not establish voter anonymity or election integrity by itself.
              </p>
            </div>
          </aside>
        </section>

        <footer className="flex flex-col items-center justify-between gap-2 border-t border-slate-200/80 py-5 text-[11px] text-slate-400 sm:flex-row">
          <span>© 2026 CivicFlow · Institutional governance</span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="check" className="h-3.5 w-3.5 text-emerald-700" />
            Independently verifiable on-chain tally
          </span>
        </footer>
      </div>
    </main>
  );
}
