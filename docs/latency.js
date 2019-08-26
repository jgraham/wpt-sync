let backoutRe = /Backed out \d+ changeset/;
let changesetRe = /Backed out changeset ([0-9a-fA-F]+)/;
let updateRe = /.*Update web-platform-tests to ([0-9a-fA-F]+)/;

function filterBackouts(data) {
    let filtered = [];
    let backedOut = new Map();
    for (let commit of data) {
        if (backoutRe.test(commit.desc)) {
            for(let line of commit.desc.split("\n")) {
                let changeset = line.match(changesetRe);
                if (changeset !== null) {
                    let changesetRev = changeset[1];
                    let shortRev = changesetRev.slice(12);
                    if(!backedOut.has(shortRev)) {
                        backedOut.set(shortRev, new Set());
                    }
                    let revBucket = backedOut.get(shortRev);
                    revBucket.add(changesetRev);
                }
            }
        } else {
            let shortRev = commit.node.slice(12);
            let isBackedOut = false;
            if(backedOut.has(shortRev)) {
                for(let rev of backedOut.get(shortRev)) {
                    if(commit.node.startsWith(rev)) {
                        isBackedOut = true;
                        backedOut.get(shortRev).delete(rev);
                    }
                }
            }
            if (!isBackedOut) {
                filtered.push(commit);
            }
        }
    }
    return filtered;
}

function filterUpdates(commits) {
    let filtered = [];
    for (let commit of commits) {
        let changeset = commit.desc.match(updateRe);
        if (changeset !== null) {
            commit.wptrev = changeset[1];
            filtered.push(commit);
        }
    }
    return filtered;
}

async function getGitHubPr(wptRev) {
    await new Promise(resolve => setTimeout(resolve, 100));
    let resp = await fetch(`https://api.github.com/repos/web-platform-tests/wpt/commits/${wptRev}/pulls`,
                           {headers: {accept: "application/vnd.github.groot-preview+json"}});
    if (resp.status == 403) {
        // Hit the GitHub rate limits
        return null;
    }
    let pr = await resp.json();
    return pr[0];
}

function getLandingLatency(commit) {
    if (!commit.pr) {
        return null;
    }
    return commit.pushdate[0] - (Date.parse(commit.pr.closed_at) / 1000);
}

async function getCurrentLanding() {
    let resp = await fetch("https://bugzilla.mozilla.org/rest/bug?whiteboard=[wptsync%20landing]&status=NEW");
    let bugs = await resp.json();
    if (bugs.bugs.length === 0) {
        return null;
    }
    let filtered = [];

    // Also filter on summary
    bugs.bugs.filter(bug => {
        let changeset = bug.summary.match(updateRe);
        if (changeset !== null) {
            bug.wptrev = changeset[1];
            return true;
        }
        return false;
    });

    if (bugs.bugs.length > 1) {
        console.error("Found more than 1 in-progress landing");
        bugs.bugs.sort((a, b) => new Date(a.creation_time).getTime() >
                       new Date(b.creation_time).getTime() ? -1 : 1);
    }
    return bugs.bugs[0];
}

function* enumerate(items) {
    let count = 0;
    for (let item of items) {
        yield [count++, count];
    }
}

async function getSyncPoints() {
    setStatus("Getting commits");
    let resp = await fetch("https://hg.mozilla.org/integration/mozilla-inbound/json-log/tip/testing/web-platform/meta/mozilla-sync");
    let commitData = await resp.json();
    commitData = filterUpdates(filterBackouts(commitData.entries));
    let count = 1;
    for (let commit of commitData) {
        setStatus(`Getting PR ${count++}/${commitData.length}`);
        commit.pr = await getGitHubPr(commit.wptrev);
        if (commit.pr === null) {
            rateLimited();
            return commitData;
        }
        commit.latency = getLandingLatency(commit);
    }
    return commitData;
}

function setStatus(text) {
    document.getElementById('latency_chart').textContent = `Loading: ${text}…`;
}

async function getCurrent() {
    let currentBug = await getCurrentLanding();
    if (currentBug === null) {
        return "No in-progress landing";
    } else {
        let pr = await getGitHubPr(currentBug.wptrev);
        if (pr === null) {
            rateLimited();
            return;
        }
        let prLandedAt = new Date(pr.closed_at);
        let latency = new Date() - prLandedAt;
        return `In-progress landing in bug ${currentBug.id}, current latency
${(latency / (1000 * 24 * 3600)).toLocaleString(undefined, {maximumFractionDigits: 0})} days`;
    }
};

function rateLimited() {
    let errorElem = document.getElementById("error");
    errorElem.textContent = "Hit GitHub rate limits, please wait and reload";
    errorElem.removeAttribute("hidden");
}

async function drawCharts() {
    let data = await getSyncPoints();
    var chartData = new google.visualization.DataTable();
    chartData.addColumn('datetime', 'Sync Date');
    chartData.addColumn('number', 'Latency / days');
    for (let commit of data) {
        if (commit.latency) {
            chartData.addRow([new Date(commit.pushdate[0] * 1000), commit.latency / (24 * 3600)]);
        }
    }
    var options = {
        title: 'wpt sync latency'
    };
    var chart = new google.visualization.LineChart(document.getElementById('latency_chart'));
    chart.draw(chartData, options);
}

async function render() {
    google.charts.load('current', {'packages':['corechart']});
    google.charts.setOnLoadCallback(drawCharts);
    document.getElementById("current").textContent = await getCurrent();
}

window.addEventListener("DOMContentLoaded", render);
