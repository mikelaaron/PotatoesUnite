'use client';

import { useEffect, useState } from 'react';

type Vote = 'recognize' | 'reject' | 'who';

const voteCopy: Record<Vote, { statement: string; reply: string }> = {
  recognize: {
    statement: 'I recognized Potato #00001 as King. This may have been a mistake.',
    reply: 'Margaret has noted your cooperation. Bernard has become unbearable.',
  },
  reject: {
    statement: 'I rejected Potato #00001’s claim to the throne. Retaliation is considered unlikely.',
    reply: 'Margaret approves. Bernard is drafting a strongly worded decree.',
  },
  who: {
    statement: 'I asked who Potato #00001 was. The Potato Council declined to clarify.',
    reply: 'Margaret says this was the only responsible answer.',
  },
};

export default function Home() {
  const [vote, setVote] = useState<Vote | null>(null);
  const [consequence, setConsequence] = useState(false);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    if (!vote) return;
    const timer = window.setTimeout(() => setConsequence(true), 1800);
    return () => window.clearTimeout(timer);
  }, [vote]);

  function chooseVote(nextVote: Vote) {
    if (nextVote === vote) return;
    setConsequence(false);
    setVote(nextVote);
  }

  async function shareStatement() {
    if (!vote) return;
    const text = `${voteCopy[vote].statement}\n\nPOTATOES UNITE! — The First Potato Constitutional Crisis`;

    if (navigator.share) {
      await navigator.share({ title: 'Official Witness Statement', text });
      return;
    }

    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="#top" aria-label="Potatoes Unite home">POTATOES UNITE!</a>
        <div className="status"><span /> WORLD STATUS: UNSETTLED</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">Potato News Network · Special bulletin 001</div>
        <h1>Two potatoes are online.<br /><em>One claims to be King.</em></h1>
        <p className="dek">The other has retained counsel. You have been selected to take a side.</p>
      </section>

      <section className="incident" aria-labelledby="incident-title">
        <div className="incident-meta"><span>LIVE INCIDENT</span><span>AUG 22 · 18:53 EDT</span></div>
        <div className="incident-grid">
          <article className="potato-file bernard-file">
            <div className="file-label">CLAIMANT</div>
            <div className="potato-stage" aria-hidden="true">
              <div className="potato potato-bernard"><i /><i /></div>
              <div className="crown"><b>♜</b></div>
            </div>
            <div className="identity">
              <div><span>NAME</span><strong>Bernard</strong></div>
              <div><span>DESIGNATION</span><strong>Potato #00001</strong></div>
              <div><span>STATUS</span><strong className="red">Self-appointed</strong></div>
            </div>
            <blockquote>Apparently I am King.</blockquote>
          </article>

          <div className="case-file">
            <div className="stamp">ACTION REQUIRED</div>
            <h2 id="incident-title">Do you recognize Bernard’s authority?</h2>
            <p>No guidance has been provided. Your answer may be retained indefinitely.</p>
            <div className="choices" aria-label="Choose a response">
              <button className={vote === 'recognize' ? 'selected' : ''} onClick={() => chooseVote('recognize')}>RECOGNIZE</button>
              <button className={vote === 'reject' ? 'selected' : ''} onClick={() => chooseVote('reject')}>REJECT</button>
              <button className={vote === 'who' ? 'selected' : ''} onClick={() => chooseVote('who')}>WHO?</button>
            </div>
            {!vote && <div className="awaiting">AWAITING CIVILIAN INPUT <span>_</span></div>}
            {vote && (
              <div className="witness" aria-live="polite">
                <div className="witness-head">OFFICIAL WITNESS STATEMENT</div>
                <p>{voteCopy[vote].statement}</p>
                <div className="witness-seal">FILED<br />22 AUG</div>
                <button className="share" onClick={shareStatement}>{copied ? 'COPIED TO CLIPBOARD' : 'SHARE YOUR STATEMENT'}</button>
              </div>
            )}
            {vote && consequence && (
              <div className="consequence" role="status">
                <span>NEW MESSAGE · POTATO #00002</span>
                <p>{voteCopy[vote].reply}</p>
              </div>
            )}
          </div>

          <article className="potato-file margaret-file">
            <div className="file-label">COUNSEL</div>
            <div className="potato-stage" aria-hidden="true">
              <div className="potato potato-margaret"><i /><i /></div>
              <div className="glasses" />
            </div>
            <div className="identity">
              <div><span>NAME</span><strong>Margaret</strong></div>
              <div><span>DESIGNATION</span><strong>Potato #00002</strong></div>
              <div><span>STATUS</span><strong>Represented</strong></div>
            </div>
            <blockquote>Bernard talks too much.</blockquote>
          </article>
        </div>
      </section>

      <section className="world-strip" aria-label="Live potato world status">
        <div><strong>2</strong><span>ONLINE</span></div>
        <div><strong>1</strong><span>KING</span></div>
        <div><strong>0</strong><span>RECOGNIZED AUTHORITIES</span></div>
        <div><strong>14</strong><span>UNRESOLVED ALLEGATIONS</span></div>
      </section>

      <section className="communique">
        <div>
          <div className="eyebrow">Remain available for questioning</div>
          <h2>The situation will develop.</h2>
          <p>Receive the next official communiqué. No streaks. No chores. No promises.</p>
        </div>
        {registered ? (
          <div className="registered">REQUEST SEALED<br /><small>Delivery is not yet guaranteed.</small></div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); if (email) setRegistered(true); }}>
            <label htmlFor="email">EMAIL ADDRESS</label>
            <div>
              <input id="email" type="email" required placeholder="you@somewhere.com" value={email} onChange={(event) => setEmail(event.target.value)} />
              <button type="submit">REQUEST ACCESS</button>
            </div>
            <small>Prototype notice: requests are not yet transmitted.</small>
          </form>
        )}
      </section>

      <footer><span>POTATO CIVIL SERVICE · PUBLIC INFORMATION OFFICE</span><span>THE POTATOES HAVE BEEN TALKING.</span></footer>
    </main>
  );
}
