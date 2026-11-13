import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { useDeployMode } from '../../shared/hooks/useAppConfig';
import { deployText, t } from '../../shared/i18n/pt-AO';
import { LinkButton, buttonClassName } from '../../shared/ui/Button';
import { Icon, StatusIcon, type IconName } from '../../shared/ui/Icon';
import { ProgressRing } from '../../shared/ui/ProgressRing';
import { StampOverlay } from '../../shared/ui/StampOverlay';
import { CompareSlider } from './CompareSlider';
import { photos, stripPhotos } from './photos';
import styles from './Landing.module.css';

const NAV = [
  { href: '#como', label: t.landing.nav.how },
  { href: '#carimbo', label: t.landing.nav.stamp },
  { href: '#instalar', label: t.landing.nav.install },
];

function Brand() {
  return (
    <a href="#topo" className={styles.brand}>
      {t.brand} <span className={styles.brandSuffix}>{t.brandSuffix}</span>
    </a>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <nav aria-label={t.landing.nav.label} className={styles.nav}>
      <Brand />
      <div className={styles.navRight}>
        <ul className={styles.navLinks}>
          {NAV.map((item) => (
            <li key={item.href}>
              <a href={item.href}>{item.label}</a>
            </li>
          ))}
        </ul>
        <Link to="/entrar" className={styles.navEnter}>
          {t.landing.nav.enter}
        </Link>
        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? t.landing.nav.closeMenu : t.landing.nav.menu}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? 'close' : 'menu'} size={20} />
        </button>
      </div>
      <ul id={menuId} className={styles.menu} hidden={!open}>
        {NAV.map((item) => (
          <li key={item.href}>
            <a href={item.href} onClick={() => setOpen(false)}>
              {item.label}
              <Icon name="chevronRight" size={18} />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function HeroCard() {
  return (
    <div className={styles.heroFloat}>
      <div className={styles.heroPill}>
        <ProgressRing
          value={37}
          size="pill"
          label={`${t.landing.heroProgress} ${t.landing.heroProgressCount}`}
        />
        <span>
          {t.landing.heroProgress} <strong>{t.landing.heroProgressCount}</strong>
        </span>
      </div>
      <div className={styles.heroCard}>
        <div className={styles.heroCardThumb}>
          <img
            src={photos.orange.src}
            srcSet={photos.orange.srcSet}
            sizes="96px"
            alt={t.landing.heroCardAlt}
          />
          <StampOverlay line1="Veste/ S e M" line2="8.000 kz" size="8.3cqi" />
        </div>
        <div className={styles.heroCardText}>
          <span className={styles.readyPill}>
            <StatusIcon kind="done" size={16} />
            {t.landing.heroReady}
          </span>
          <span className={styles.heroCardStamp}>Veste/ S e M</span>
          <span className={styles.heroCardPrice}>8.000 kz</span>
        </div>
      </div>
    </div>
  );
}

const INSTALL_ICONS: IconName[] = ['wifi', 'phone', 'key'];

export function LandingPage() {
  const mode = useDeployMode();
  const text = deployText(mode);
  const host = typeof window === 'undefined' ? '' : window.location.host;
  const installSteps = [
    { title: text.installStep1Title, body: text.installStep1Body(host) },
    { title: t.landing.install.step2Title, body: t.landing.install.step2Body },
    { title: t.landing.install.step3Title, body: t.landing.install.step3Body },
  ];

  return (
    <div className={styles.landing} id="topo">
      <header className={styles.hero}>
        <div className={styles.heroMedia}>
          <img
            src={photos.polka.src}
            srcSet={photos.polka.srcSet}
            sizes="(min-width: 1200px) 60vw, 100vw"
            alt={t.landing.heroPhotoAlt}
            fetchPriority="high"
          />
          <div className={styles.heroFade} aria-hidden="true" />
        </div>
        <Nav />
        <HeroCard />
        <div className={styles.heroCopy}>
          <div className={styles.heroHeadline}>
            <p className={styles.eyebrow}>{t.landing.eyebrow}</p>
            <h1 className={styles.display}>
              {t.landing.titleBefore}
              <em>{t.landing.titleAccent}</em>
              {t.landing.titleAfter}
            </h1>
          </div>
          <div className={styles.heroDetails}>
            <p className={styles.lead}>{t.landing.lead}</p>
            <div className={styles.heroActions}>
              <LinkButton to="/entrar" iconAfter="arrowRight">
                {t.landing.ctaEnter}
              </LinkButton>
              <a href="#instalar" className={buttonClassName('outline')}>
                {t.landing.ctaInstall}
              </a>
            </div>
            <p className={styles.note}>
              <span className={styles.noteDot} aria-hidden="true" />
              {text.heroNote}
            </p>
          </div>
        </div>
      </header>

      <main>
        <section id="como" className={`${styles.section} ${styles.how}`} aria-labelledby="como-titulo">
          <div className={styles.howHead}>
            <div className={styles.sectionHead}>
              <p className={styles.eyebrowMuted}>{t.landing.how.eyebrow}</p>
              <h2 id="como-titulo" className={styles.h2}>
                {t.landing.how.title}
              </h2>
            </div>
            <p className={styles.howAside}>{t.landing.how.aside}</p>
          </div>
          <ol className={styles.steps}>
            {t.landing.how.steps.map((step) => (
              <li key={step.n} className={styles.step}>
                <span className={styles.stepNumber}>{step.n}</span>
                <div className={styles.stepText}>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <ul className={styles.strip} aria-label={t.landing.how.stripLabel} tabIndex={0}>
            {stripPhotos.map((photo, index) => (
              <li key={index} className={styles.stripItem}>
                <img
                  src={photo.src}
                  srcSet={photo.srcSet}
                  sizes="(min-width: 1200px) 220px, (min-width: 768px) 190px, 150px"
                  alt={photo.alt}
                  loading="lazy"
                />
                <StampOverlay line1="Veste/ M e L" line2="10.000 kz" size="5.6cqi" />
              </li>
            ))}
          </ul>
        </section>

        <section
          id="carimbo"
          className={`${styles.section} ${styles.stamp}`}
          aria-labelledby="carimbo-titulo"
        >
          <div className={styles.stampHead}>
            <p className={styles.eyebrowMuted}>{t.landing.stamp.eyebrow}</p>
            <h2 id="carimbo-titulo" className={styles.h2}>
              {t.landing.stamp.title}
            </h2>
            <p className={styles.stampBody}>{t.landing.stamp.body}</p>
          </div>
          <CompareSlider photo={photos.blue} />
          <dl className={styles.rules}>
            {t.landing.stamp.rules.map((rule) => (
              <div key={rule.term} className={styles.rule}>
                <dt>{rule.term}</dt>
                <dd>
                  {rule.value}
                  {rule.hint ? (
                    <span className={'accent' in rule ? styles.ruleAccent : styles.ruleHint}>
                      {' '}
                      {rule.hint}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          id="instalar"
          className={`${styles.section} ${styles.install}`}
          aria-labelledby="instalar-titulo"
        >
          <div className={styles.sectionHead}>
            <p className={styles.eyebrowMuted}>{t.landing.install.eyebrow}</p>
            <h2 id="instalar-titulo" className={styles.h2}>
              {t.landing.install.title}
            </h2>
          </div>
          <ol className={styles.installCards}>
            {installSteps.map((step, index) => (
              <li key={step.title} className={styles.installCard}>
                <div className={styles.installTop}>
                  <span className={styles.installNumber}>{index + 1}</span>
                  <span className={styles.installIcon}>
                    <Icon name={INSTALL_ICONS[index] ?? 'wifi'} size={26} />
                  </span>
                </div>
                <div className={styles.installText}>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="entrar" className={`${styles.section} ${styles.final}`} aria-labelledby="entrar-titulo">
          <h2 id="entrar-titulo" className={styles.finalTitle}>
            {t.landing.final.before}
            <em>{t.landing.final.accent}</em>
            {t.landing.final.after}
          </h2>
          <LinkButton to="/entrar" iconAfter="arrowRight" className={styles.finalButton}>
            {t.landing.ctaEnter}
          </LinkButton>
        </section>
      </main>

      <footer className={styles.footer}>
        <span className={styles.footerBrand}>
          {t.brand} <span className={styles.brandSuffix}>{t.brandSuffix}</span>
        </span>
        <div className={styles.footerMeta}>
          <span>{t.landing.footer.city}</span>
          <span className={styles.footerPrivate}>
            <Icon name="lock" size={16} />
            {t.landing.footer.private}
          </span>
        </div>
      </footer>
    </div>
  );
}
