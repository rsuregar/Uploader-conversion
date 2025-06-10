"use client"

import type React from "react"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Upload, FileArchive, Download, X, CheckCircle, AlertCircle } from "lucide-react"
import JSZip from "jszip"
// import { saveAs } from "file-saver"

interface FileItem {
  id: string
  name: string
  size: number
  status: "pending" | "uploading" | "converting" | "completed" | "error"
  uploadProgress: number
  convertProgress: number
  error?: string
  convertedFile?: Blob
  originalFile: File
}

export default function ZipConverter() {
  const [files, setFiles] = useState<FileItem[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const updateFileStatus = useCallback((id: string, updates: Partial<FileItem>) => {
    setFiles((prev) => prev.map((file) => (file.id === id ? { ...file, ...updates } : file)))
  }, [])

  const convertZipToTarGz = async (file: File, fileId: string) => {
    try {
      updateFileStatus(fileId, { status: "converting", convertProgress: 0 })

      // Read the ZIP file
      const zip = new JSZip()
      const zipContent = await zip.loadAsync(file)

      updateFileStatus(fileId, { convertProgress: 20 })

      // Extract files from ZIP
      const files: { name: string; content: Uint8Array }[] = []
      const fileNames = Object.keys(zipContent.files)

      for (let i = 0; i < fileNames.length; i++) {
        const fileName = fileNames[i]
        const zipFile = zipContent.files[fileName]

        if (!zipFile.dir) {
          const content = await zipFile.async("uint8array")
          files.push({ name: fileName, content })
        }

        updateFileStatus(fileId, {
          convertProgress: 20 + (i / fileNames.length) * 40,
        })
      }

      updateFileStatus(fileId, { convertProgress: 60 })

      // Create TAR archive manually (simplified version)
      const tarData: Uint8Array[] = []

      for (const file of files) {
        // TAR header (512 bytes)
        const header = new Uint8Array(512)
        const nameBytes = new TextEncoder().encode(file.name)
        header.set(nameBytes.slice(0, 100)) // filename (100 bytes)

        // File mode (8 bytes) - "0000644 "
        const mode = new TextEncoder().encode("0000644 ")
        header.set(mode, 100)

        // Owner ID (8 bytes) - "0000000 "
        const uid = new TextEncoder().encode("0000000 ")
        header.set(uid, 108)

        // Group ID (8 bytes) - "0000000 "
        const gid = new TextEncoder().encode("0000000 ")
        header.set(gid, 116)

        // File size (12 bytes) - octal
        const sizeOctal = file.content.length.toString(8).padStart(11, "0") + " "
        const sizeBytes = new TextEncoder().encode(sizeOctal)
        header.set(sizeBytes, 124)

        // Modification time (12 bytes) - octal
        const mtime =
          Math.floor(Date.now() / 1000)
            .toString(8)
            .padStart(11, "0") + " "
        const mtimeBytes = new TextEncoder().encode(mtime)
        header.set(mtimeBytes, 136)

        // Checksum (8 bytes) - calculate and set
        let checksum = 0
        for (let i = 0; i < 512; i++) {
          checksum += header[i]
        }
        // Add 8 spaces for checksum field in calculation
        checksum += 8 * 32
        const checksumOctal = checksum.toString(8).padStart(6, "0") + "\0 "
        const checksumBytes = new TextEncoder().encode(checksumOctal)
        header.set(checksumBytes, 148)

        tarData.push(header)

        // File content
        tarData.push(file.content)

        // Padding to 512-byte boundary
        const padding = 512 - (file.content.length % 512)
        if (padding < 512) {
          tarData.push(new Uint8Array(padding))
        }
      }

      // End of archive (two 512-byte zero blocks)
      tarData.push(new Uint8Array(512))
      tarData.push(new Uint8Array(512))

      updateFileStatus(fileId, { convertProgress: 80 })

      // Combine all TAR data
      const totalLength = tarData.reduce((sum, chunk) => sum + chunk.length, 0)
      const tarBuffer = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of tarData) {
        tarBuffer.set(chunk, offset)
        offset += chunk.length
      }

      updateFileStatus(fileId, { convertProgress: 90 })

      // Compress with GZIP
      const pako = await import("pako")
      const gzipData = pako.gzip(tarBuffer)
      const convertedBlob = new Blob([gzipData], { type: "application/gzip" })

      updateFileStatus(fileId, {
        status: "completed",
        convertProgress: 100,
        convertedFile: convertedBlob,
      })
    } catch (error) {
      console.error("Conversion error:", error)
      updateFileStatus(fileId, {
        status: "error",
        error: error instanceof Error ? error.message : "Conversion failed",
      })
    }
  }

  const simulateUpload = async (file: File, fileId: string) => {
    updateFileStatus(fileId, { status: "uploading", uploadProgress: 0 })

    // Simulate upload progress
    for (let i = 0; i <= 100; i += 10) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      updateFileStatus(fileId, { uploadProgress: i })
    }

    // Start conversion after upload
    await convertZipToTarGz(file, fileId)
  }

  const handleFiles = (fileList: FileList) => {
    const newFiles: FileItem[] = []

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]

      if (!file.name.toLowerCase().endsWith(".zip")) {
        continue
      }

      const fileItem: FileItem = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        size: file.size,
        status: "pending",
        uploadProgress: 0,
        convertProgress: 0,
        originalFile: file,
      }

      newFiles.push(fileItem)
    }

    setFiles((prev) => [...prev, ...newFiles])

    // Start processing files
    newFiles.forEach((fileItem) => {
      simulateUpload(fileItem.originalFile, fileItem.id)
    })
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files)
    }
  }

  const downloadFile = (file: FileItem) => {
    if (file.convertedFile) {
      const fileName = file.name.replace(/\.zip$/i, ".tar.gz")
      const url = URL.createObjectURL(file.convertedFile)
      const link = document.createElement("a")
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    }
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((file) => file.id !== id))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="w-5 h-5" />
            ZIP to TAR.GZ Converter
          </CardTitle>
          <CardDescription>Upload ZIP files to convert them to TAR.GZ format with progress tracking</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">Drop ZIP files here</h3>
            <p className="text-muted-foreground mb-4">or click to browse and select files</p>
            <input type="file" multiple accept=".zip" onChange={handleFileInput} className="hidden" id="file-input" />
            <Button asChild>
              <label htmlFor="file-input" className="cursor-pointer">
                Select Files
              </label>
            </Button>
          </div>
        </CardContent>
      </Card>

      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>File Processing</CardTitle>
            <CardDescription>Track the progress of your file uploads and conversions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {files.map((file) => (
              <div key={file.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileArchive className="w-5 h-5" />
                    <div>
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        file.status === "completed" ? "default" : file.status === "error" ? "destructive" : "secondary"
                      }
                    >
                      {file.status === "pending" && "Pending"}
                      {file.status === "uploading" && "Uploading"}
                      {file.status === "converting" && "Converting"}
                      {file.status === "completed" && "Completed"}
                      {file.status === "error" && "Error"}
                    </Badge>
                    {file.status === "completed" && (
                      <Button size="sm" onClick={() => downloadFile(file)} className="gap-1">
                        <Download className="w-4 h-4" />
                        Download
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeFile(file.id)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {file.status === "uploading" && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Uploading...</span>
                      <span>{file.uploadProgress}%</span>
                    </div>
                    <Progress value={file.uploadProgress} />
                  </div>
                )}

                {file.status === "converting" && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Converting to TAR.GZ...</span>
                      <span>{Math.round(file.convertProgress)}%</span>
                    </div>
                    <Progress value={file.convertProgress} />
                  </div>
                )}

                {file.status === "completed" && (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>File successfully converted to TAR.GZ format</AlertDescription>
                  </Alert>
                )}

                {file.status === "error" && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{file.error || "An error occurred during processing"}</AlertDescription>
                  </Alert>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
