import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KAYTTAJA = "pave699";
const AIKAVYOHYKE = "Europe/Helsinki";
const HAKEMISTO = dirname(fileURLToPath(import.meta.url));

const KUUT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VIIKONPAIVAT = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const EI_KIELIA = new Set(["Markdown", "JSON", "YAML", "TOML", "Text", "CSV", "XML", "INI", "Ignore List", "Git Attributes", "Batchfile"]);

const TEEMAT = {
    tumma: {
        tausta: "#09090b",
        reuna: "#27272a",
        teksti: "#fafafa",
        himmea: "#a1a1aa",
        viiva: "#d4d4d8",
        alue: "#fafafa",
        alueAlku: 0.16,
        pohja: "#27272a",
        palkki: "#3f3f46",
        kulta: "#fcc300",
        kultaReuna: "#09090b",
        kielet: ["#fafafa", "#a1a1aa", "#71717a", "#52525b", "#3f3f46", "#27272a"],
    },
    vaalea: {
        tausta: "#ffffff",
        reuna: "#e4e4e7",
        teksti: "#09090b",
        himmea: "#52525b",
        viiva: "#3f3f46",
        alue: "#09090b",
        alueAlku: 0.1,
        pohja: "#e4e4e7",
        palkki: "#d4d4d8",
        kulta: "#fcc300",
        kultaReuna: "#8a6a00",
        kielet: ["#09090b", "#52525b", "#71717a", "#a1a1aa", "#d4d4d8", "#e4e4e7"],
    },
};

const W = 840;
const X0 = 32;
const X1 = W - 32;
const KAAVIO_YLA = 172;
const KAAVIO_ALA = 290;
const ALAOSA = 360;
const SARAKE = 232;
const SARAKKEET = [X0, X0 + SARAKE + 40, X0 + 2 * (SARAKE + 40)];

const luku = (n) => new Intl.NumberFormat("en-US").format(n);
const osat = (pv) => pv.split("-").map(Number);
const paivaa = (n) => `${luku(n)} ${n === 1 ? "day" : "days"}`;
const lyhytPvm = (pv, tanaan) => {
    const [v, k, p] = osat(pv);
    return v === osat(tanaan)[0] ? `${KUUT[k - 1]} ${p}` : `${KUUT[k - 1]} ${p}, ${v}`;
};
const viikonpaiva = (pv) => (new Date(`${pv}T12:00:00Z`).getUTCDay() + 6) % 7;

async function haeKalenteri(kysely = "") {
    const vastaus = await fetch(`https://github.com/users/${KAYTTAJA}/contributions${kysely}`, {
        headers: { "User-Agent": KAYTTAJA },
    });
    if (!vastaus.ok) throw new Error(`GitHub vastasi ${vastaus.status}`);
    const html = await vastaus.text();

    const maarat = new Map();
    for (const [, id, teksti] of html.matchAll(/<tool-tip[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
        const osuma = teksti.trim().match(/^([\d,]+) contributions? on/);
        maarat.set(id, osuma ? Number(osuma[1].replace(/,/g, "")) : 0);
    }

    const paivat = [];
    for (const [solu] of html.matchAll(/<td\b[^>]*\bdata-date="[^"]+"[^>]*>/g)) {
        const pv = solu.match(/data-date="([^"]+)"/)[1];
        const id = solu.match(/\bid="([^"]+)"/)[1];
        if (!maarat.has(id)) throw new Error(`Päivälle ${pv} ei löytynyt määrää`);
        paivat.push({ pv, n: maarat.get(id) });
    }
    paivat.sort((a, b) => a.pv.localeCompare(b.pv));
    if (paivat.length < 360) throw new Error(`Kalenterissa vain ${paivat.length} päivää`);

    const otsikko = html.match(/([\d,]+)\s+contributions?\s+in\s+(?:the last year|\d{4})/);
    const yhteensa = paivat.reduce((s, p) => s + p.n, 0);
    if (!otsikko || Number(otsikko[1].replace(/,/g, "")) !== yhteensa) {
        throw new Error(`Päivien summa ${yhteensa} ei täsmää GitHubin lukuun ${otsikko?.[1]}`);
    }
    return paivat;
}

async function haeKaikki(tanaan) {
    const luotu = await fetch(`https://api.github.com/users/${KAYTTAJA}`, { headers: { "User-Agent": KAYTTAJA } }).then((r) => r.json());
    const eka = Number((luotu.created_at ?? "2024").slice(0, 4));
    const kaikki = [];
    for (let v = eka; v <= osat(tanaan)[0]; v++) {
        kaikki.push(...(await haeKalenteri(`?from=${v}-01-01&to=${v}-12-31`)));
    }
    return kaikki.filter((p) => p.pv <= tanaan);
}

async function graphql(token, query, variables) {
    const vastaus = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: `bearer ${token}`, "User-Agent": KAYTTAJA },
        body: JSON.stringify({ query, variables }),
    });
    const json = await vastaus.json();
    if (!vastaus.ok || json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors ?? json.message ?? vastaus.status)}`);
    return json.data;
}

async function haeYksityiset(token) {
    const nyt = new Date();
    const vuosiSitten = new Date(nyt.getTime() - 365 * 864e5);
    const { user } = await graphql(
        token,
        `query($login: String!, $from: DateTime!, $to: DateTime!) {
            user(login: $login) {
                id
                repositories(first: 100, ownerAffiliations: [OWNER], isFork: false) {
                    nodes { languages(first: 20, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } } }
                }
                contributionsCollection(from: $from, to: $to) {
                    commitContributionsByRepository(maxRepositories: 100) { repository { name owner { login } } }
                }
            }
        }`,
        { login: KAYTTAJA, from: vuosiSitten.toISOString(), to: nyt.toISOString() }
    );

    const kielet = new Map();
    for (const repo of user.repositories.nodes) {
        for (const { size, node } of repo.languages.edges) {
            if (!EI_KIELIA.has(node.name)) kielet.set(node.name, (kielet.get(node.name) ?? 0) + size);
        }
    }

    const tunti = new Intl.DateTimeFormat("en-GB", { timeZone: AIKAVYOHYKE, hour: "numeric", hourCycle: "h23" });
    const tunnit = Array(24).fill(0);
    for (const { repository } of user.contributionsCollection.commitContributionsByRepository) {
        let after = null;
        do {
            const data = await graphql(
                token,
                `query($owner: String!, $name: String!, $id: ID!, $since: GitTimestamp!, $after: String) {
                    repository(owner: $owner, name: $name) {
                        defaultBranchRef { target { ... on Commit {
                            history(first: 100, after: $after, since: $since, author: { id: $id }) {
                                pageInfo { hasNextPage endCursor }
                                nodes { authoredDate }
                            }
                        } } }
                    }
                }`,
                { owner: repository.owner.login, name: repository.name, id: user.id, since: vuosiSitten.toISOString(), after }
            );
            const historia = data.repository?.defaultBranchRef?.target?.history;
            if (!historia) break;
            for (const { authoredDate } of historia.nodes) tunnit[Number(tunti.format(new Date(authoredDate)))]++;
            after = historia.pageInfo.hasNextPage ? historia.pageInfo.endCursor : null;
        } while (after);
    }

    return { kielet: [...kielet].map(([nimi, koko]) => ({ nimi, koko })), tunnit };
}

function putket(paivat) {
    let pisin = 0;
    let juokseva = 0;
    for (const p of paivat) {
        juokseva = p.n > 0 ? juokseva + 1 : 0;
        pisin = Math.max(pisin, juokseva);
    }
    let i = paivat.length - 1;
    if (paivat[i].n === 0) i--;
    let nyt = 0;
    while (i >= 0 && paivat[i].n > 0) {
        nyt++;
        i--;
    }
    return { nyt, pisin };
}

export function laske(vuosi, kaikki, yksityiset) {
    const tanaan = vuosi.at(-1).pv;
    const { nyt, pisin } = putket(kaikki);
    const paras = kaikki.reduce((a, b) => (b.n > a.n ? b : a));

    const viikot = [];
    for (let j = vuosi.length - 1; j >= 6; j -= 7) {
        viikot.unshift({ j, v: vuosi.slice(j - 6, j + 1).reduce((s, p) => s + p.n, 0) });
    }

    const paivittain = Array(7).fill(0);
    for (const p of vuosi) paivittain[viikonpaiva(p.pv)] += p.n;

    let kielet = null;
    if (yksityiset?.kielet.length) {
        const summa = yksityiset.kielet.reduce((s, k) => s + k.koko, 0);
        const jarjestys = [...yksityiset.kielet].sort((a, b) => b.koko - a.koko);
        const karki = jarjestys.slice(0, 5).filter((k) => k.koko / summa >= 0.01);
        const muut = summa - karki.reduce((s, k) => s + k.koko, 0);
        kielet = karki.map((k) => ({ nimi: k.nimi, osuus: k.koko / summa }));
        if (muut > 0) kielet.push({ nimi: "Other", osuus: muut / summa });
    }

    return {
        tanaan,
        vuosi: vuosi.reduce((s, p) => s + p.n, 0),
        kaikki: kaikki.reduce((s, p) => s + p.n, 0),
        aktiiviset: vuosi.filter((p) => p.n > 0).length,
        putki: nyt,
        pisin,
        paras,
        viikot,
        paivittain,
        tunnit: yksityiset?.tunnit ?? null,
        kielet,
    };
}

function kayra(p) {
    const n = p.length;
    const d = [];
    const m = [];
    for (let i = 0; i < n - 1; i++) d[i] = (p[i + 1].y - p[i].y) / (p[i + 1].x - p[i].x);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
        if (d[i] === 0) {
            m[i] = 0;
            m[i + 1] = 0;
            continue;
        }
        const a = m[i] / d[i];
        const b = m[i + 1] / d[i];
        const s = a * a + b * b;
        if (s > 9) {
            const k = 3 / Math.sqrt(s);
            m[i] = k * a * d[i];
            m[i + 1] = k * b * d[i];
        }
    }
    let polku = `M${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
        const h = (p[i + 1].x - p[i].x) / 3;
        polku += `C${(p[i].x + h).toFixed(1)} ${(p[i].y + m[i] * h).toFixed(1)} ${(p[i + 1].x - h).toFixed(1)} ${(p[i + 1].y - m[i + 1] * h).toFixed(1)} ${p[i + 1].x.toFixed(1)} ${p[i + 1].y.toFixed(1)}`;
    }
    return polku;
}

function kaavio(vuosi, viikot, t) {
    const eka = viikot[0].j;
    const vika = viikot.at(-1).j;
    const huippu = Math.max(1, ...viikot.map((v) => v.v));
    const x = (j) => X0 + ((j - eka) / (vika - eka)) * (X1 - X0);
    const y = (v) => KAAVIO_ALA - (v / (huippu * 1.08)) * (KAAVIO_ALA - KAAVIO_YLA);

    const pisteet = viikot.map((v) => ({ x: x(v.j), y: y(v.v) }));
    const viiva = kayra(pisteet);
    const alue = `${viiva}L${X1} ${KAAVIO_ALA}L${X0} ${KAAVIO_ALA}Z`;

    const kuut = [];
    for (let j = eka; j <= vika; j++) {
        const [, k, p] = osat(vuosi[j].pv);
        if (p === 1 && x(j) > X0 + 8 && x(j) < X1 - 16) kuut.push({ x: x(j), nimi: KUUT[k - 1] });
    }
    const loppu = pisteet.at(-1);

    return `<line x1="${X0}" y1="${KAAVIO_ALA + 0.5}" x2="${X1}" y2="${KAAVIO_ALA + 0.5}" stroke="${t.pohja}"/>
  <path d="${alue}" fill="url(#alue)"/>
  <path d="${viiva}" fill="none" stroke="${t.viiva}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>
  ${kuut.map((k) => `<text x="${k.x.toFixed(1)}" y="${KAAVIO_ALA + 24}" class="i4 pieni" fill="${t.himmea}" text-anchor="middle">${k.nimi}</text>`).join("\n  ")}
  <circle cx="${loppu.x.toFixed(1)}" cy="${loppu.y.toFixed(1)}" r="4.5" fill="${t.kulta}" stroke="${t.kultaReuna}" stroke-width="1.5"/>`;
}

function palkit(x0, otsikko, arvot, merkit, t) {
    const leveys = SARAKE;
    const vali = arvot.length > 10 ? 3 : 12;
    const pl = (leveys - vali * (arvot.length - 1)) / arvot.length;
    const yla = ALAOSA + 22;
    const ala = ALAOSA + 84;
    const huippu = Math.max(1, ...arvot);
    const paras = arvot.indexOf(Math.max(...arvot));

    const suorat = arvot.map((v, i) => {
        const x = x0 + i * (pl + vali);
        const k = Math.max(2, (v / huippu) * (ala - yla));
        return `<rect x="${x.toFixed(1)}" y="${(ala - k).toFixed(1)}" width="${pl.toFixed(1)}" height="${k.toFixed(1)}" rx="${Math.min(3, pl / 2).toFixed(1)}" fill="${i === paras && v > 0 ? t.teksti : t.palkki}"/>`;
    });
    const tekstit = merkit
        .map(([i, nimi]) => `<text x="${(x0 + i * (pl + vali) + pl / 2).toFixed(1)}" y="${ala + 20}" class="i4 pieni" fill="${t.himmea}" text-anchor="middle">${nimi}</text>`)
        .join("");

    return `<text x="${x0}" y="${ALAOSA}" class="i5 normaali" fill="${t.himmea}">${otsikko}</text>
  ${suorat.join("")}
  ${tekstit}`;
}

function kielialue(x0, kielet, t) {
    let x = x0;
    const palat = kielet.map((k, i) => {
        const w = Math.max(2, k.osuus * SARAKE);
        const pala = `<rect x="${x.toFixed(1)}" y="${ALAOSA + 22}" width="${w.toFixed(1)}" height="8" fill="${t.kielet[i]}"/>`;
        x += w;
        return pala;
    });
    const rivit = kielet.map((k, i) => {
        const sx = x0 + (i % 2) * (SARAKE / 2 + 8);
        const sy = ALAOSA + 56 + Math.floor(i / 2) * 22;
        const pros = k.osuus < 0.01 ? "<1%" : `${Math.round(k.osuus * 100)}%`;
        return `<rect x="${sx}" y="${sy - 9}" width="8" height="8" rx="2" fill="${t.kielet[i]}" stroke="${t.reuna}"/>
  <text x="${sx + 14}" y="${sy}" class="i5 pieni" fill="${t.teksti}">${k.nimi}</text>
  <text x="${sx + SARAKE / 2 - 8}" y="${sy}" class="i4 pieni" fill="${t.himmea}" text-anchor="end">${pros}</text>`;
    });

    return `<text x="${x0}" y="${ALAOSA}" class="i5 normaali" fill="${t.himmea}">languages</text>
  <clipPath id="kieliraja"><rect x="${x0}" y="${ALAOSA + 22}" width="${SARAKE}" height="8" rx="4"/></clipPath>
  <g clip-path="url(#kieliraja)">${palat.join("")}</g>
  ${rivit.join("\n  ")}`;
}

function fontit() {
    const b64 = (nimi) => readFileSync(join(HAKEMISTO, "fontit", nimi)).toString("base64");
    return `@font-face{font-family:P;font-weight:600;src:url(data:font/woff2;base64,${b64("poppins600.woff2")}) format("woff2")}
    @font-face{font-family:I;font-weight:400;src:url(data:font/woff2;base64,${b64("inter400.woff2")}) format("woff2")}
    @font-face{font-family:I;font-weight:500;src:url(data:font/woff2;base64,${b64("inter500.woff2")}) format("woff2")}`;
}

export function kortti(vuosi, s, t) {
    const tilastot = [
        { arvo: paivaa(s.putki), nimi: "current streak" },
        { arvo: paivaa(s.pisin), nimi: "longest streak" },
        { arvo: luku(s.paras.n), nimi: `best day, ${lyhytPvm(s.paras.pv, s.tanaan)}` },
        s.kaikki > s.vuosi * 1.02 ? { arvo: luku(s.kaikki), nimi: "all time" } : { arvo: luku(s.aktiiviset), nimi: "active days" },
    ];

    const alaosat = [];
    if (s.kielet) alaosat.push((x) => kielialue(x, s.kielet, t));
    alaosat.push((x) => palkit(x, "by weekday", s.paivittain, VIIKONPAIVAT.map((n, i) => [i, n]), t));
    if (s.tunnit) alaosat.push((x) => palkit(x, "by hour", s.tunnit, [[0, "00"], [6, "06"], [12, "12"], [18, "18"], [23, "23"]], t));
    const H = ALAOSA + 140;
    const kuvaus = `${luku(s.vuosi)} contributions in the last year`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${kuvaus}">
  <title>${kuvaus}</title>
  <style>
    ${fontit()}
    text{font-family:I,"Segoe UI",system-ui,sans-serif}
    .p6{font-family:P,"Segoe UI",system-ui,sans-serif;font-weight:600}
    .i4{font-weight:400}
    .i5{font-weight:500}
    .pieni{font-size:12px}
    .normaali{font-size:13px}
  </style>
  <defs>
    <linearGradient id="alue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.alue}" stop-opacity="${t.alueAlku}"/>
      <stop offset="1" stop-color="${t.alue}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.tausta}" stroke="${t.reuna}"/>
  <text x="${X0 - 2}" y="80" class="p6" font-size="46" fill="${t.teksti}">${luku(s.vuosi)}</text>
  <text x="${X0}" y="104" class="i5 normaali" fill="${t.himmea}">contributions in the last year</text>
  ${tilastot
      .map((k, i) => {
          const x = 520 + (i % 2) * 150;
          const y = 62 + Math.floor(i / 2) * 58;
          return `<text x="${x}" y="${y}" class="p6" font-size="20" fill="${t.teksti}">${k.arvo}</text>
  <text x="${x}" y="${y + 20}" class="i5 pieni" fill="${t.himmea}">${k.nimi}</text>`;
      })
      .join("\n  ")}
  ${kaavio(vuosi, s.viikot, t)}
  <line x1="${X0}" y1="${ALAOSA - 30.5}" x2="${X1}" y2="${ALAOSA - 30.5}" stroke="${t.pohja}"/>
  ${alaosat.map((f, i) => f(SARAKKEET[i])).join("\n  ")}
</svg>
`;
}

export function kirjoita(ulos, vuosi, tilasto) {
    mkdirSync(ulos, { recursive: true });
    for (const [nimi, teema] of Object.entries(TEEMAT)) writeFileSync(join(ulos, `${nimi}.svg`), kortti(vuosi, tilasto, teema));
}

export { haeKalenteri, haeKaikki };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const vuosi = await haeKalenteri();
    const kaikki = await haeKaikki(vuosi.at(-1).pv);
    const token = process.env.KORTTI_TOKEN;
    const yksityiset = token ? await haeYksityiset(token) : null;
    const tilasto = laske(vuosi, kaikki, yksityiset);
    kirjoita(process.argv[2] ?? HAKEMISTO, vuosi, tilasto);
    console.log(`${luku(tilasto.vuosi)} contributions, all time ${luku(tilasto.kaikki)}, streak ${tilasto.putki}, longest ${tilasto.pisin}, token ${token ? "yes" : "no"}`);
}
