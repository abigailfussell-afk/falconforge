const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'src', 'pages', 'Landing.tsx');
const content = fs.readFileSync(targetFile, 'utf8');

// The file has these markers:
// {/* Sprint Planning Section */}
// {/* Pre-Match Checklist Section */}
// {/* Scouting Reports Section */}
// {/* Match Planner Section */}
// {/* Roles / Pricing Section */}

const parts = content.split(/(\{\/\* [A-Za-z \-\/]+ Section \*\/})/g);

// parts will be an array of:
// 0: stuff before first section
// 1: marker 1
// 2: section 1 content
// 3: marker 2
// 4: section 2 content
// ...

let beforeAll = "";
let sprintPlanning = "";
let preMatchList = "";
let scoutingReports = "";
let matchPlanner = "";
let afterAll = "";

for(let i=0; i < parts.length; i++) {
    if (parts[i] === '{/* Sprint Planning Section */}') {
        sprintPlanning = parts[i] + parts[i+1];
        i++;
    } else if (parts[i] === '{/* Pre-Match Checklist Section */}') {
        preMatchList = parts[i] + parts[i+1];
        i++;
    } else if (parts[i] === '{/* Scouting Reports Section */}') {
        scoutingReports = parts[i] + parts[i+1];
        i++;
    } else if (parts[i] === '{/* Match Planner Section */}') {
        matchPlanner = parts[i] + parts[i+1];
        i++;
    } else if (parts[i] === '{/* Roles / Pricing Section */}') {
        afterAll = parts[i] + parts[i+1];
        for(let j = i+2; j < parts.length; j++) {
            afterAll += parts[j];
        }
        break;
    } else {
        beforeAll += parts[i];
    }
}

// Target Order: Sprint -> Match Planner -> Scouting -> Pre-Match Checklist
const newContent = beforeAll + sprintPlanning + matchPlanner + scoutingReports + preMatchList + afterAll;

fs.writeFileSync(targetFile, newContent);
console.log("Reordered sections successfully.");
