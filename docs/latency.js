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

async function getGitHubPr(commit) {
    await new Promise(resolve => setTimeout(resolve, 100));
    wptRev = commit.wptrev;
    let resp = await fetch(`https://api.github.com/repos/web-platform-tests/wpt/commits/${wptRev}/pulls`,
                           {headers: {accept: "application/vnd.github.groot-preview+json"}})
    let pr = await resp.json();
    return pr[0];
}

function getLandingLatency(commit) {
    if (!commit.pr) {
        return null;
    }
    return commit.pushdate[0] - (Date.parse(commit.pr.closed_at) / 1000);
}

function* enumerate(items) {
    let count = 0;
    for (let item of items) {
        yield [count++, count];
    }
}

async function getSyncPoints() {
    let resp = await fetch("https://hg.mozilla.org/mozilla-central/json-log/tip/testing/web-platform/meta/mozilla-sync");
    let commitData = await resp.json();
    commitData = filterUpdates(filterBackouts(commitData.entries));
    for (let commit of commitData) {
        commit.pr = await getGitHubPr(commit);
        commit.latency = getLandingLatency(commit);
    }
    console.log(commitData);
    return commitData;
}


async function drawCharts() {
    let data = await getSyncPoints();
    var chartData = new google.visualization.DataTable();
    chartData.addColumn('number', 'Sync Date');
    chartData.addColumn('number', 'Latency');
    for (let commit of data) {
        chartData.addRow([commit.pushdate[0], commit.latency]);
    }
    var options = {
        title: 'wpt sync latency'
    };
    var chart = new google.visualization.LineChart(document.getElementById('latency_chart'));
    chart.draw(chartData, options);
}

google.charts.load('current', {'packages':['corechart']});
google.charts.setOnLoadCallback(drawCharts);
