import type { VehicleImageUpload, vehicleImageTypes } from "@terhal/contracts";
import { ApiError, call, staffApi } from "@/lib/api";
import { networkError } from "@/lib/api/errors";

// Puts the file on the link with its signed headers, reporting progress (0 to 1) as it goes. XMLHttpRequest, not fetch:
// only it reports an upload's progress. No cookies: the link is the credential.
const put = (link: VehicleImageUpload, file: File, onProgress: (share: number) => void) =>
  new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(link.method, link.url);
    for (const [name, value] of Object.entries(link.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(
          new ApiError({
            status: request.status,
            code: request.status === 413 ? "PAYLOAD_TOO_LARGE" : "UNEXPECTED_RESPONSE",
            detail: `Storage answered ${String(request.status)}.`,
          }),
        );
      }
    };
    request.onerror = () => reject(networkError(new Error("The upload failed.")));
    request.send(file);
  });

// A vehicle photo, the way the API takes them: ask for a link, put the file straight into storage, then confirm, which
// checks the file and adds it. Answers with the vehicle and its photos.
export async function uploadVehiclePhoto(
  vehicleId: string,
  file: File,
  onProgress: (share: number) => void,
) {
  const param = { id: vehicleId };
  const link = await call(
    staffApi.vehicles[":id"].images.uploads.$post({
      param,
      // The caller has checked the type is one of these; the API checks again, and the bytes on confirming.
      json: { contentType: file.type as (typeof vehicleImageTypes)[number], size: file.size },
    }),
  );
  await put(link, file, onProgress);
  return call(staffApi.vehicles[":id"].images.$post({ param, json: { uploadId: link.uploadId } }));
}
