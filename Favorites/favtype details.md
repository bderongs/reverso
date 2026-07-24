# Context

Among the different attributes of the favorites table, there is a “favType” attribute that identifies what kind of favorite we are dealing with. 

This document describes the possible types, and how should the other attributes of the favorites table be used if they are being used differently from the description given in the table here:

# Possible Types

### Context saved term → `Empty or null`

Terms saved from context

Can include an example, but not mandatory

Mandatory, can’t be null:

- srcText: term
- trgText: translation from context
- srcLang: lang of the source term
- trgLang: lang of the target term

Optional:

- srcContext: example in source lang containing the source term
- trgContext: example in target lang containing the target term
- srcPos: POS for source term
- trgPos: POS for target term

### AI gen term → `ctx-genai`

Terms issues from using the gen AI feature

Is exactly the same as a context saved term, the example is likely to be ai generated too

Same display rules as for context saved terms in reverso.net vocabulary pages and elsewhere

### Machine translated term → `mt`

Used to saved translation results from reverso.net mt 

### Synonyms → `syn`

Used to represent a favorites saved from the synonyms service

- srcText: term
- trgText: synonym
- srcLang & trgLang (source and target languages): same language (srcLang = trglang)

<aside>
<img src="/icons/extension_gray.svg" alt="/icons/extension_gray.svg" width="40px" /> **Api criteria**
By default, synonyms are not included in Vocabulary API call results. 
To include synonymes, include the url parameter `includeSyn=YES` ****in the request
possible values are YES, NO, ONLY

</aside>

### Definitions (and ai definitions) → `def`  and `def-genai`

The attributes from the favorites will be used as follow:

- srcText: Term
- trgText: Definition (clients should send empty string, null is not accepted)
- srcContext: Term example with alignment (not mandatory, could be without)
- favType: “def” OR “aidef”
- srcLang & trgLang: Like Synonyms (srcLang = trglang)
- trgContext: Target example stays empty

<aside>
<img src="/icons/extension_gray.svg" alt="/icons/extension_gray.svg" width="40px" /> **Api criteria**
By default, definitions are not included in Vocabulary API call results. 
To include definitions, include the url parameter `includeDef=YES` ****in the request
possible values are YES, NO, ONLY
This will include both definition and AI definition in the result

</aside>

### Deleted terms → `REMOVED = TRUE`

A favorite is never deleted from the database itself

Instead, when a user requests to delete a term from their favorites, we marked them as removed.

<aside>
<img src="/icons/extension_gray.svg" alt="/icons/extension_gray.svg" width="40px" /> **Api criteria**
By default, removed terms are not included in Vocabulary API call results. 
To include removed, include the url parameter `includeRemoved` in the request
possible values are true and false

</aside>

# API Swagger file

Swagger UI