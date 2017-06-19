"use strict";

// Lambda doesn't contain either aws cli or zip command
// Using Gulp was the easiest workaround I could find...

import * as gulp from "gulp";
import * as modifyFile from "gulp-modify-file";
import * as s3 from "gulp-s3-upload";
import * as zip from "gulp-zip";
import * as yaml from "js-yaml";
import * as VinylFile from "vinyl";

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

function updateMainTemplateArtifactPaths(content: string, path: string, file: VinylFile): string {
  const template: any = yaml.safeLoad(content); // Unfortunately I don't see any types for CF Templates in the AWS SDK

  // TODO: Is there a type for functionResources?
  const functionResources = Object.keys(template.Resources).filter((key) => {
    return template.Resources[key].Type === "AWS::Lambda::Function";
  }).map((key) => {
    return template.Resources[key];
  });

  if (!functionResources.length) {
    throw new Error("No function resources found!");
  }

  if (functionResources.length > 1) {
    throw new Error("Build processes assumes only one function resource.");
  }

  functionResources[0].Properties.Code.S3Bucket = BUCKET_NAME;
  functionResources[0].Properties.Code.S3Key = prependKeyPrefix(CODE_KEY_NAME);

  // We could convert this to JSON, but it's probably easier for debugging to just leave it as YAML
  return yaml.safeDump(template);
}

function updateTestTemplateArtifactPaths(content: string, path: string, file: VinylFile): string {
  const template: any = yaml.safeLoad(content);

  Object.keys(template.Resources).filter((key) => {
    return template.Resources[key].Type === "AWS::CloudFormation::Stack";
  }).map((key) => {
    const stackResource = template.Resources[key];

    // Assume stackResource.Properties.TemplateURL already has the name of the template.
    // We will prepend the rest of the URL.
    stackResource.Properties.TemplateURL = constructS3URL(prependKeyPrefix(stackResource.Properties.TemplateURL));
  });

  return yaml.safeDump(template);
}

gulp.task("package", () => {
  gulp.src("../packaged/**/*")
    .pipe(zip(CODE_KEY_NAME))
    .pipe(s3()({
      Bucket: BUCKET_NAME,
      keyTransform: prependKeyPrefix,
    }));
  gulp.src("../" + MAIN_TEMPLATE_NAME)
    .pipe(modifyFile(updateMainTemplateArtifactPaths))
    .pipe(s3()({
      Bucket: BUCKET_NAME,
      keyTransform: prependKeyPrefix,
    }))
    .on("end", () => {
      console.log(constructS3URL(prependKeyPrefix(MAIN_TEMPLATE_NAME)));
    });
  gulp.src("../" + TEST_TEMPLATE_NAME)
    .pipe(modifyFile(updateTestTemplateArtifactPaths))
    .pipe(s3()({
      Bucket: BUCKET_NAME,
      keyTransform: prependKeyPrefix,
    }))
    .on("end", () => {
      console.log(constructS3URL(prependKeyPrefix(TEST_TEMPLATE_NAME)));
    });
  gulp.src("../" + SQS_REDIRECT_TEMPLATE_NAME)
    .pipe(modifyFile(updateTestTemplateArtifactPaths))
    .pipe(s3()({
      Bucket: BUCKET_NAME,
      keyTransform: prependKeyPrefix,
    }))
    .on("end", () => {
      console.log(constructS3URL(prependKeyPrefix(SQS_REDIRECT_TEMPLATE_NAME)));
    });
  },
);
