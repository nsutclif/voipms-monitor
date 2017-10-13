"use strict";

// Lambda doesn't contain either aws cli or zip command
// Using Gulp was the easiest workaround I could find...

import * as gulp from "gulp";
import * as s3 from "gulp-s3-upload";
import * as zip from "gulp-zip";

const BUCKET_NAME = "lambci-buildresults-ga8wy7gvebrx"; // TODO: Don't hard-code this!
const CODE_KEY_NAME = "PollVoipMSFunction.zip";
const MAIN_TEMPLATE_NAME = "template.yml";
const SQS_REDIRECT_TEMPLATE_NAME = "sqsredirectedtemplate.yml";
const TEST_TEMPLATE_NAME = "testtemplate.yml";

function prependKeyPrefix(relativeFilename: string): string {
    return [ // TODO: Don't hard code this?
        "gh",
        process.env.LAMBCI_REPO || "nsutclif/voipms-monitor",
        "builds",
        process.env.LAMBCI_BUILD_NUM || "local",
        relativeFilename,
    ].join("/");
}

function constructS3URL(keyName: string): string {
    return ["https://s3.amazonaws.com", BUCKET_NAME, keyName].join("/");
}

gulp.task("package", () => {
    function logCompletedFile(keyname: string): void {
        console.log(constructS3URL(keyname));
    }

    gulp.src("../packaged/**/*")
        .pipe(zip(CODE_KEY_NAME))
        .pipe(s3()({
            Bucket: BUCKET_NAME,
            keyTransform: prependKeyPrefix,
        }));
    gulp.src("../cloudformation/*.yml")
        .pipe(s3()({
            Bucket: BUCKET_NAME,
            keyTransform: prependKeyPrefix,
            onChange: logCompletedFile,
            onNoChange: logCompletedFile,
            onNew: logCompletedFile,
        }));
    },
);
