const axios = require('axios');

const PAYPLUS_BASE_URL = process.env.PAYPLUS_BASE_URL || 'https://restapi.payplus.co.il/api/v1.0';
const PAYPLUS_API_KEY = process.env.PAYPLUS_API_KEY;
const PAYPLUS_SECRET_KEY = process.env.PAYPLUS_SECRET_KEY;

/**
 * Download a PayPlus invoice document (original or copy) for a given transaction
 * and stream it directly to the Express response.
 */
async function downloadFamilyInvoiceFromPayPlus({ transaction_uid, type = 'original', format = 'pdf', paymentId, res, payplusResponseData = null }) {
  try {
    // Validate type parameter
    if (!['original', 'copy'].includes(type)) {
      return res.status(400).json({
        status: 'error',
        message: 'Type must be either "original" or "copy"'
      });
    }

    // First, try to get invoice URLs directly from response data if available
    let downloadUrl = null;
    if (payplusResponseData) {
      try {
        const responseData = typeof payplusResponseData === 'string' 
          ? JSON.parse(payplusResponseData) 
          : payplusResponseData;
        
        // Handle double-encoded JSON strings
        const parsedData = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
        
        downloadUrl = type === 'original' 
          ? parsedData.invoice_original_url 
          : parsedData.invoice_copy_url;
      } catch (parseError) {
        console.error(`[downloadFamilyInvoiceFromPayPlus] Error parsing payplusResponseData:`, parseError);
      }
    }

    // If no URL in response data, call GetDocuments API
    if (!downloadUrl || downloadUrl.trim() === '') {
      
      // Get invoice documents from PayPlus
      const payplusUrl = `${PAYPLUS_BASE_URL}/Invoice/GetDocuments`;
      const requestData = {
        transaction_uid,
        filter: {}
      };

      const headers = {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': PAYPLUS_API_KEY,
        'secret-key': PAYPLUS_SECRET_KEY
      };

      const response = await axios.post(payplusUrl, requestData, {
        headers,
        timeout: 30000
      });

      if (
        response.status !== 200 ||
        !response.data ||
        !response.data.invoices ||
        response.data.invoices.length === 0
      ) {
        return res.status(404).json({
          status: 'error',
          message: 'No invoice documents found for this payment',
          payment_id: paymentId,
          transaction_uid
        });
      }

      // Find the first successful invoice
      const invoice = response.data.invoices.find((inv) => inv.status === 'success');
      if (!invoice) {
        return res.status(404).json({
          status: 'error',
          message: 'No successful invoice found for this payment',
          payment_id: paymentId,
          transaction_uid
        });
      }

      // Get the appropriate download URL
      downloadUrl = type === 'original' ? invoice.original_doc_url : invoice.copy_doc_url;

      if (!downloadUrl || downloadUrl.trim() === '') {
        return res.status(404).json({
          status: 'error',
          message: `${type} document URL not available for this invoice`,
          payment_id: paymentId,
          transaction_uid,
          available_types: {
            original: !!invoice.original_doc_url,
            copy: !!invoice.copy_doc_url
          }
        });
      }
    }

    // Download the document from PayPlus
    const documentResponse = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'api-key': PAYPLUS_API_KEY,
        'secret-key': PAYPLUS_SECRET_KEY
      }
    });

    if (documentResponse.status !== 200) {
      throw new Error(`Failed to download document: HTTP ${documentResponse.status}`);
    }

    // Set response headers for file download
    const contentType = documentResponse.headers['content-type'] || 'application/pdf';
    const filename = `family_invoice_${transaction_uid}_${type}.${format}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Stream the document to the client
    documentResponse.data.pipe(res);

    // Handle stream errors
    documentResponse.data.on('error', (error) => {
      console.error('Error streaming family invoice document:', error);
      if (!res.headersSent) {
        res.status(500).json({
          status: 'error',
          message: 'Error streaming invoice document',
          details: error.message
        });
      }
    });
  } catch (error) {
    console.error(`Error downloading family invoice for payment ${paymentId}:`, error);

    if (res.headersSent) {
      return;
    }

    if (error.response) {
      const statusCode = error.response.status;
      const errorData = error.response.data;

      if (statusCode === 404) {
        return res.status(404).json({
          status: 'error',
          message: 'Invoice document not found',
          payment_id: paymentId
        });
      }

      if (statusCode === 401 || statusCode === 403) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication failed with PayPlus API'
        });
      }

      return res.status(500).json({
        status: 'error',
        message: 'PayPlus API error during download',
        details: errorData || error.message,
        status_code: statusCode
      });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Error downloading invoice',
      details: error.message
    });
  }
}

module.exports = {
  downloadFamilyInvoiceFromPayPlus
};


