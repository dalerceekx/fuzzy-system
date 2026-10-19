#!/usr/bin/env bash
# Review and run manually with an AWS provisioning identity. Creates resources.
set -euo pipefail
bucket=${1:?Usage: setup-s3.sh BUCKET REGION}
region=${2:?Region required}
[[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || exit 1
[[ "$region" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]$ ]] || exit 1
args=(--bucket "$bucket" --region "$region")
if [[ "$region" != us-east-1 ]]; then args+=(--create-bucket-configuration "LocationConstraint=$region"); fi
aws s3api create-bucket "${args[@]}"
aws s3api put-public-access-block --bucket "$bucket" --region "$region" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls --bucket "$bucket" --region "$region" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-encryption --bucket "$bucket" --region "$region" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-versioning --bucket "$bucket" --region "$region" --versioning-configuration Status=Enabled
aws s3api put-bucket-policy --bucket "$bucket" --region "$region" --policy \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Deny\",\"Principal\":\"*\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::$bucket\",\"arn:aws:s3:::$bucket/*\"],\"Condition\":{\"Bool\":{\"aws:SecureTransport\":\"false\"}}}]}"
echo 'Private versioned S3 bucket ready. Configure app IAM policy and api.env.'
